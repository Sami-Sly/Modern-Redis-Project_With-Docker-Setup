import express, { type Request } from "express";

import { nanoid } from "nanoid";
import { validate } from "../middleware/validate.js";
import { RestaurantDetailsSchema, RestaurantSchema, type Restaurant, type RestaurantDetails } from "../schemas/restaurant.js";
import { initializeRedisClient } from "../utils/client.js";
import { bloomKey, cuisineKey,  cuisinesKey,  indexKey,    restaurantCuisinesKeyById, restaurantDetailsKeyById, restaurantKeyById, restaurantsByRatingKey, reviewDetailsKeyById, reviewKeyById, weatherKeyById } from "../utils/keys.js";
import { errorResponse, successResponse } from "../utils/response.js";
import { checkRestaurantExists } from "../middleware/checkRestaurantId.js";
import { ReviewSchema, type Review } from "../schemas/review.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();


router.get("/", async (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  const start = (Number(page) - 1) * Number(limit);
  const end = start + Number(limit);

  try {
    const client = await initializeRedisClient();
    const restaurantIds = await client.zRange(
      restaurantsByRatingKey,
      start,
      end,
      {
        REV: true,
      }
    );
    const restaurants = await Promise.all(
      restaurantIds.map((id) => client.hGetAll(restaurantKeyById(id)))
    );
    return successResponse(res, restaurants);
  } catch (error) {
    next(error);
  }
});

router.post("/", validate(RestaurantSchema), async (req, res, next) => {
  const data = req.body as Restaurant;
  try {
    const client = await initializeRedisClient();
    const id = nanoid();
    const restaurantKey = restaurantKeyById(id);
    const bloomString = `${data.name}:${data.location}`;
    const seenBefore = await client.bf.exists(bloomKey, bloomString);
    if (seenBefore) {
      return errorResponse(res, 409, "Restaurant already exists");
    }
    const hashData = { id, name: data.name, location: data.location };
    await Promise.all([
      ...data.cuisines.map((cuisine) =>
        Promise.all([
          client.sAdd(cuisinesKey, cuisine),
          client.sAdd(cuisineKey(cuisine), id),
          client.sAdd(restaurantCuisinesKeyById(id), cuisine),
        ])
      ),
      client.hSet(restaurantKey, hashData),
      client.zAdd(restaurantsByRatingKey, {
        score: 0,
        value: id,
      }),
      client.bf.add(bloomKey, bloomString),
    ]);
    return successResponse(res, hashData, "Added new restaurant");
  } catch (error) {
    next(error);
  }
});


router.post(
  "/:restaurantId/details",
  checkRestaurantExists,
  validate(RestaurantDetailsSchema),
  async (req: Request<{ restaurantId: string }>, res, next) => {
    const { restaurantId } = req.params;
    const data = req.body as RestaurantDetails;

    try {
      const client = await initializeRedisClient();
      const restaurantDetailsKey = restaurantDetailsKeyById(restaurantId);
      await client.json.set(restaurantDetailsKey, ".", data);
      return successResponse(res, {}, "Restaurant details added");
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:restaurantId/details",
  checkRestaurantExists,
  async (req: Request<{ restaurantId: string }>, res, next) => {
    const { restaurantId } = req.params;
    const data = req.body as RestaurantDetails;

    try {
      const client = await initializeRedisClient();
      const restaurantDetailsKey = restaurantDetailsKeyById(restaurantId);
      const details = await client.json.get(restaurantDetailsKey);
      return successResponse(res, details);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:restaurantId/reviews",
  checkRestaurantExists,
  validate(ReviewSchema),
  async (req: Request<{ restaurantId: string }>, res, next) => {
    const { restaurantId } = req.params;
    const data = req.body as Review;
    try {
      const client = await initializeRedisClient();
      const reviewId = nanoid();
      const reviewKey = reviewKeyById(restaurantId);
      const reviewDetailsKey = reviewDetailsKeyById(reviewId);
      const restaurantKey = restaurantKeyById(restaurantId);
      const reviewData = {
        id: reviewId,
        ...data,
        timestamp: Date.now(),
        restaurantId,
      };
      const [reviewCount, setResult, totalStars] = await Promise.all([
        client.lPush(reviewKey, reviewId),
        client.hSet(reviewDetailsKey, reviewData),
        client.hIncrByFloat(restaurantKey, "totalStars", data.rating),
      ]);
const numericTotalStars = Number(totalStars);
const numericReviewCount = Number(reviewCount);
      const averageRating = Number((numericTotalStars / numericReviewCount).toFixed(1));


      await Promise.all([
        client.zAdd(restaurantsByRatingKey, {
          score: averageRating,
          value: restaurantId,
        }),
        client.hSet(restaurantKey, "avgStars", averageRating),
      ]);

      return successResponse(res, reviewData, "Review added");
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:restaurantId/weather",
  checkRestaurantExists,
  async (req: Request<{ restaurantId: string }>, res, next) => {
    try {
      const { restaurantId } = req.params;
      const client = await initializeRedisClient();
      const weatherKey = weatherKeyById(restaurantId);
      const restaurantKey = restaurantKeyById(restaurantId);

      // Try cache first
      const cachedWeather = await client.get(weatherKey);
      if (cachedWeather) {
        console.log("Cache Hit");
        try {
          return successResponse(res, JSON.parse(cachedWeather));
        } catch {
          await client.del(weatherKey);
        }
      }

      // Get coordinates
      const coords = await client.hGet(restaurantKey, "location");
      if (!coords) return errorResponse(res, 404, "Coordinates not found");

      const [lng, lat] = coords.split(",");

      // Fetch from API
      if (!process.env.WEATHER_API_KEY)
        throw new Error("Missing WEATHER_API_KEY");

      const apiUrl = `https://api.openweathermap.org/data/2.5/weather?units=imperial&lat=${lat}&lon=${lng}&appid=${process.env.WEATHER_API_KEY}`;
      const apiResponse = await fetch(apiUrl);

      if (!apiResponse.ok)
        return errorResponse(res, 500, "Couldn't fetch weather info");

      const json = await apiResponse.json();

      // Cache result for 1 hour
      await client.set(weatherKey, JSON.stringify(json), { EX: 3600 });

      return successResponse(res, json);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/search", async (req, res, next) => {
  const { q } = req.query;
  try {
    const client = await initializeRedisClient();
    const results = await client.ft.search(indexKey, `@name:${q}`);


    const cleanResults =
      results?.documents?.map((doc) => ({
        id: doc.value.id,
        name: doc.value.name,
        avgStars: doc.value.avgStars,
      })) || [];

    // ✅ Send array in data field (frontend ready)
    return successResponse(res, cleanResults);

    // return successResponse(res, results);
  } catch (error) {
    next(error);
  }
});
router.get(
  "/:restaurantId/reviews",
  checkRestaurantExists,
  async (req: Request<{ restaurantId: string }>, res, next) => {
    const { restaurantId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const start = (Number(page) - 1) * Number(limit);
    const end = start + Number(limit) - 1;

    try {
      const client = await initializeRedisClient();
      const reviewKey = reviewKeyById(restaurantId);
      const reviewIds = await client.lRange(reviewKey, start, end);
      const reviews = await Promise.all(
        reviewIds.map((id) => client.hGetAll(reviewDetailsKeyById(id)))
      );
      return successResponse(res, reviews);
    } catch (error) {
      next(error);
    }
  }
);



router.delete(
  "/:restaurantId/reviews/:reviewId",
  checkRestaurantExists,
  async (
    req: Request<{ restaurantId: string; reviewId: string }>,
    res,
    next
  ) => {
    const { restaurantId, reviewId } = req.params;

    try {
      const client = await initializeRedisClient();
      const reviewKey = reviewKeyById(restaurantId);
      const reviewDetailsKey = reviewDetailsKeyById(reviewId);
      const [removeResult, deleteResult] = await Promise.all([
        client.lRem(reviewKey, 0, reviewId),
        client.del(reviewDetailsKey),
      ]);
      if (removeResult === 0 && deleteResult === 0) {
        return errorResponse(res, 404, "Review not found");
      }
      return successResponse(res, reviewId, "Review deleted");
    } catch (error) {
      next(error);
    }
  }
);
router.get(
  "/:restaurantId",
  checkRestaurantExists,
  async (req: Request<{ restaurantId: string }>, res, next) => {
    const { restaurantId } = req.params;
    try {
      const client = await initializeRedisClient();
      const restaurantKey = restaurantKeyById(restaurantId);
      const [viewCount, restaurant, cuisines] = await Promise.all([
        client.hIncrBy(restaurantKey, "viewCount", 1),
        client.hGetAll(restaurantKey),
        client.sMembers(restaurantCuisinesKeyById(restaurantId)),
      ]);
      return successResponse(res, { ...restaurant, cuisines });
    } catch (error) {
      next(error);
    }
  }
);
// localhost8001 for redis
export default router;









// import express, { Request, Response, NextFunction } from "express";
// import { initializeRedisClient } from "../lib/redis";
// import { successResponse, errorResponse } from "../helpers/responseHelper";

// const router = express.Router();
// const indexKey = "idx:restaurants"; // your RediSearch index name

// // -------------------------------------------------------------
// // 1️⃣ SEARCH BY NAME
// // -------------------------------------------------------------
// router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { q } = req.query; // e.g. /search?q=burger
//     if (!q) return errorResponse(res, 400, "Please provide a search term");

//     const client = await initializeRedisClient();
//     const results = await client.ft.search(indexKey, `@name:${q}*`);

//     return successResponse(res, results, "Search results fetched successfully");
//   } catch (error) {
//     next(error);
//   }
// });

// // -------------------------------------------------------------
// // 2️⃣ FILTER BY CATEGORY
// // -------------------------------------------------------------
// router.get("/filter/category", async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { category } = req.query; // e.g. /filter/category?category=FastFood
//     if (!category) return errorResponse(res, 400, "Category is required");

//     const client = await initializeRedisClient();
//     const results = await client.ft.search(indexKey, `@category:{${category}}`);

//     return successResponse(res, results, "Category filter results fetched");
//   } catch (error) {
//     next(error);
//   }
// });

// // -------------------------------------------------------------
// // 3️⃣ FILTER BY RATING RANGE
// // -------------------------------------------------------------
// router.get("/filter/rating", async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { minStars = "0", maxStars = "5" } = req.query; // e.g. /filter/rating?minStars=4&maxStars=5

//     const client = await initializeRedisClient();
//     const results = await client.ft.search(indexKey, `@avgStars:[${minStars} ${maxStars}]`);

//     return successResponse(res, results, "Rating range results fetched");
//   } catch (error) {
//     next(error);
//   }
// });

// // -------------------------------------------------------------
// // 4️⃣ FILTER BY LOCATION (Geo Search)
// // -------------------------------------------------------------
// router.get("/filter/location", async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { lat, lon, radius } = req.query; // e.g. /filter/location?lat=33.6844&lon=73.0479&radius=10

//     if (!lat || !lon || !radius) {
//       return errorResponse(res, 400, "lat, lon, and radius are required");
//     }

//     const client = await initializeRedisClient();
//     const query = `@location:[${lon} ${lat} ${radius} km]`;
//     const results = await client.ft.search(indexKey, query);

//     return successResponse(res, results, "Nearby restaurants fetched successfully");
//   } catch (error) {
//     next(error);
//   }
// });

// export default router;

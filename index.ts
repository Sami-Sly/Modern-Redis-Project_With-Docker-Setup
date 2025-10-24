import express from "express";
import path from "path";
import cors from "cors";
import restaurantsRouter from "./routes/restaurant.js";
import cuisinesRouter from "./routes/cuisines.js";
import { errorHandler } from "./middleware/errorHandler.js";
import dotenv from "dotenv";
dotenv.config();


const PORT = process.env.PORT || 7000;
const app = express();

// ✅ CORS setup (allow frontend on localhost:3000)
// app.use(
//   cors({
//     origin: "http://localhost:3000", // your frontend URL
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: "https://modern-redis-project-with-docker-se.vercel.app", // your frontend URL
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// cuisines and weather api check from postman 
// ✅ Root route
app.get("/", (req, res) => {
  res.json({ message: "API is running 🚀", docs: "/api-docs" });
});

// ✅ API Routes
app.use("/restaurants", restaurantsRouter);
app.use("/cuisines", cuisinesRouter);

// ✅ Error handler
app.use(errorHandler);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
}).on("error", (error) => {
  throw new Error(error.message);
});




// https://www.totaltypescript.com/tsconfig-cheat-sheet
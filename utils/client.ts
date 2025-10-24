import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;

export async function initializeRedisClient() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });
    
    client.on("error", (error) => console.error(error));
    client.on("connect", () => console.log("Redis connected"));
    
    await client.connect();
  }
  return client;
}

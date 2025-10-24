import type { Response } from "express";

export function successResponse(
  res: Response,
  data: any,
  message: string = "Success"
) {
  return res.status(200).json({ success: true, message, data });
}

export function errorResponse(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}


// ✅ Keeps API responses consistent across the whole app
// ✅ Easier for frontend to handle success/error in one format
// ✅ Cleaner code — no repeated res.status(...).json(...) calls everywhere
// ✅ Helps with logging, debugging, and maintainability
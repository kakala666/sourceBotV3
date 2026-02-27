import { Response } from 'express';
import type { ApiResponse } from 'shared';

export function success<T>(res: Response, data?: T, statusCode = 200) {
  const body: ApiResponse<T> = { success: true };
  if (data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
}

export function fail(res: Response, message: string, statusCode = 400) {
  const body: ApiResponse = { success: false, message };
  return res.status(statusCode).json(body);
}

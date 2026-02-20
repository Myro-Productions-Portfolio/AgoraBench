import type { Request, Response, NextFunction } from 'express';
import type { ApiResponse } from '@shared/types';
import { ZodError } from 'zod';
import { config } from '../config';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ApiResponse<null>>,
  _next: NextFunction,
): void {
  console.error(`[ERROR] ${err.name}: ${err.message}`);

  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: messages.join('; '),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  /* Do not expose internal details in production */
  const message = config.isDev ? err.message : 'Internal server error';

  res.status(500).json({
    success: false,
    error: message,
  });
}

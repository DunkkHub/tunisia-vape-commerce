import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export const requestIdMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  const supplied = request.header('x-request-id');
  request.requestId = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
};

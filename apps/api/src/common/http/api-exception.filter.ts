import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface NestErrorResponse {
  message?: string | string[];
  error?: string;
  code?: string;
  blockers?: unknown;
}

const BLOCKER_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_BLOCKER_CODES = 20;

const safeBlockerCodes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const blockers: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (blockers.length >= MAX_BLOCKER_CODES) break;
    if (
      typeof candidate !== 'string' ||
      !BLOCKER_CODE_PATTERN.test(candidate) ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    blockers.push(candidate);
  }
  return blockers;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttpException ? exception.getResponse() : undefined;
    const detail: NestErrorResponse = {};
    if (typeof raw === 'object' && raw !== null) {
      if ('message' in raw && (typeof raw.message === 'string' || Array.isArray(raw.message))) {
        detail.message = raw.message;
      }
      if ('error' in raw && typeof raw.error === 'string') detail.error = raw.error;
      if ('code' in raw && typeof raw.code === 'string') detail.code = raw.code;
      if ('blockers' in raw) detail.blockers = raw.blockers;
    }
    const validationMessages = Array.isArray(detail.message) ? detail.message : undefined;
    const blockers = safeBlockerCodes(detail.blockers);

    response.status(statusCode).json({
      statusCode,
      code:
        detail.code ??
        (statusCode === 400
          ? 'VALIDATION_ERROR'
          : statusCode === 500
            ? 'INTERNAL_ERROR'
            : (detail.error ?? 'REQUEST_REJECTED').toUpperCase().replaceAll(' ', '_')),
      message: validationMessages
        ? 'The submitted data is invalid.'
        : typeof detail.message === 'string'
          ? detail.message
          : statusCode === 500
            ? 'An unexpected error occurred.'
            : 'The request could not be completed.',
      requestId: request.requestId,
      ...(validationMessages ? { errors: { request: validationMessages } } : {}),
      ...(blockers.length > 0 ? { blockers } : {}),
    });
  }
}

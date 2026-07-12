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
}

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
    }
    const validationMessages = Array.isArray(detail.message) ? detail.message : undefined;

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
    });
  }
}

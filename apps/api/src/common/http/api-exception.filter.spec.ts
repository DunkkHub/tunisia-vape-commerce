import { BadRequestException, ConflictException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter';

const catchException = (exception: unknown) => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: 'request-id' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);

  return { json, status };
};

describe('ApiExceptionFilter publication blockers', () => {
  it('preserves only unique bounded uppercase blocker codes', () => {
    const validBlockers = Array.from({ length: 24 }, (_, index) => `BLOCKER_${index}`);
    const { json, status } = catchException(
      new ConflictException({
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        message: 'The product does not meet the operational publication requirements.',
        blockers: [
          validBlockers[0],
          validBlockers[0],
          'lowercase_blocker',
          'BLOCKER-WITH-DASH',
          ' BLOCKER_WITH_SPACES ',
          { secret: 'must-not-be-serialized' },
          ...validBlockers.slice(1),
        ],
      }),
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'PRODUCT_PUBLICATION_NOT_READY',
      message: 'The product does not meet the operational publication requirements.',
      requestId: 'request-id',
      blockers: validBlockers.slice(0, 20),
    });
  });

  it('omits blockers when the exception does not provide a safe blocker array', () => {
    const { json } = catchException(
      new BadRequestException({
        code: 'INVALID_CATALOG_REFERENCE',
        message: 'The selected category or brand is not available for this product.',
        blockers: 'DRAFT_TAXONOMY',
      }),
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'INVALID_CATALOG_REFERENCE',
      message: 'The selected category or brand is not available for this product.',
      requestId: 'request-id',
    });
  });
});

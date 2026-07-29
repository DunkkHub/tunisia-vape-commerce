import { describe, expect, it } from 'vitest';

import { DeliveryMethodOptionDto } from './geography.dto';

describe('DeliveryMethodOptionDto public contract', () => {
  it('documents every safe operational field and omits internal fulfillment controls', () => {
    const properties = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      DeliveryMethodOptionDto.prototype,
    ) as string[];

    expect(properties).toEqual(
      expect.arrayContaining([
        ':estimatedMinDays',
        ':estimatedMaxDays',
        ':estimatedMinMinutes',
        ':estimatedMaxMinutes',
        ':paymentMethod',
        ':phoneConfirmationRequired',
      ]),
    );
    expect(properties).not.toEqual(
      expect.arrayContaining([':assignmentMode', ':driverCommunication', ':manualReviewRequired']),
    );
  });
});

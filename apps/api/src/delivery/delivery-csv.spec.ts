import { DeliveryStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_STATUS_CSV_HEADERS,
  DELIVERY_STATUS_CSV_SCHEMA,
  parseDeliveryStatusCsv,
  serializeDeliveryStatusCsv,
} from './delivery-csv';
import type { DeliveryCsvError } from './delivery-csv';

const csv = (row: string) => `${DELIVERY_STATUS_CSV_HEADERS.join(',')}\r\n${row}\r\n`;

describe('delivery status CSV contract', () => {
  it('exports a versioned template and neutralizes spreadsheet formulas', () => {
    const result = serializeDeliveryStatusCsv([
      {
        deliveryId: 'delivery-1',
        expectedVersion: 3,
        currentStatus: DeliveryStatus.PREPARING,
        orderNumber: '=cmd()',
        trackingNumber: '+SUM(1,2)',
        courierCode: '@REMOTE',
        expectedCodMillimes: 12_500,
        ageVerificationRequired: true,
        updatedAt: new Date('2026-07-20T10:00:00.000Z'),
      },
    ]);

    expect(result).toContain(DELIVERY_STATUS_CSV_HEADERS.join(','));
    expect(result).toContain("'=cmd()");
    expect(result).toContain('"\'+SUM(1,2)"');
    expect(result).toContain("'@REMOTE");
  });

  it('parses one exact-schema command including a quoted note', () => {
    const result = parseDeliveryStatusCsv(
      csv(
        `${DELIVERY_STATUS_CSV_SCHEMA},delivery-1,3,PREPARING,ASSIGNED_TO_COURIER,CSV_ASSIGN,"checked, ready",TN-1,,,12500,true,2026-07-20T10:00:00.000Z`,
      ),
    );

    expect(result).toEqual([
      {
        row: 2,
        deliveryId: 'delivery-1',
        expectedVersion: 3,
        currentStatus: DeliveryStatus.PREPARING,
        targetStatus: DeliveryStatus.ASSIGNED_TO_COURIER,
        reasonCode: 'CSV_ASSIGN',
        note: 'checked, ready',
      },
    ]);
  });

  it('rejects duplicate delivery identifiers before any service mutation', () => {
    const row = `${DELIVERY_STATUS_CSV_SCHEMA},delivery-1,3,PREPARING,ASSIGNED_TO_COURIER,,,,,,0,false,2026-07-20T10:00:00.000Z`;
    expect(() => parseDeliveryStatusCsv(csv(`${row}\r\n${row}`))).toThrowError(
      expect.objectContaining<Partial<DeliveryCsvError>>({
        code: 'DELIVERY_CSV_DUPLICATE_DELIVERY',
        row: 3,
      }),
    );
  });

  it('rejects completion targets so CSV cannot bypass age or COD evidence', () => {
    expect(() =>
      parseDeliveryStatusCsv(
        csv(
          `${DELIVERY_STATUS_CSV_SCHEMA},delivery-1,3,OUT_FOR_DELIVERY,DELIVERED,,,,,,12500,true,2026-07-20T10:00:00.000Z`,
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DeliveryCsvError>>({
        code: 'DELIVERY_CSV_TARGET_STATUS_INVALID',
      }),
    );
  });
});

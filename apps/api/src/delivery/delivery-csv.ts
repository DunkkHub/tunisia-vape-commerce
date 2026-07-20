import { DeliveryStatus } from '@prisma/client';
import { serializeCsv } from '../common/export/csv';
import { OPERATIONAL_DELIVERY_TARGETS } from './delivery-transition-policy';

export { serializeCsv } from '../common/export/csv';

export const DELIVERY_STATUS_CSV_SCHEMA = 'DELIVERY_STATUS_V1' as const;
export const DELIVERY_STATUS_CSV_MAX_ROWS = 500;
export const DELIVERY_STATUS_CSV_MAX_BYTES = 250_000;

export const DELIVERY_STATUS_CSV_HEADERS = [
  'schemaVersion',
  'deliveryId',
  'expectedVersion',
  'currentStatus',
  'targetStatus',
  'reasonCode',
  'note',
  'orderNumber',
  'trackingNumber',
  'courierCode',
  'expectedCodMillimes',
  'ageVerificationRequired',
  'updatedAt',
] as const;

export interface DeliveryStatusCsvCommand {
  row: number;
  deliveryId: string;
  expectedVersion: number;
  currentStatus: DeliveryStatus;
  targetStatus: (typeof OPERATIONAL_DELIVERY_TARGETS)[number];
  reasonCode: string | null;
  note: string | null;
}

export interface DeliveryStatusCsvExportRow {
  deliveryId: string;
  expectedVersion: number;
  currentStatus: DeliveryStatus;
  orderNumber: string;
  trackingNumber: string | null;
  courierCode: string | null;
  expectedCodMillimes: number;
  ageVerificationRequired: boolean;
  updatedAt: Date;
}

export class DeliveryCsvError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly row?: number,
  ) {
    super(message);
  }
}

export const serializeDeliveryStatusCsv = (rows: readonly DeliveryStatusCsvExportRow[]): string =>
  serializeCsv(
    DELIVERY_STATUS_CSV_HEADERS,
    rows.map((row) => [
      DELIVERY_STATUS_CSV_SCHEMA,
      row.deliveryId,
      row.expectedVersion,
      row.currentStatus,
      '',
      '',
      '',
      row.orderNumber,
      row.trackingNumber,
      row.courierCode,
      row.expectedCodMillimes,
      row.ageVerificationRequired,
      row.updatedAt.toISOString(),
    ]),
  );

export const parseDeliveryStatusCsv = (input: string): DeliveryStatusCsvCommand[] => {
  if (Buffer.byteLength(input, 'utf8') > DELIVERY_STATUS_CSV_MAX_BYTES) {
    throw new DeliveryCsvError('DELIVERY_CSV_TOO_LARGE', 'The CSV exceeds the 250 KB limit.');
  }
  if (input.includes('\0')) {
    throw new DeliveryCsvError('DELIVERY_CSV_INVALID', 'The CSV contains a null byte.');
  }
  const rows = parseCsvRows(input.replace(/^\uFEFF/, ''));
  if (rows.length < 2) {
    throw new DeliveryCsvError(
      'DELIVERY_CSV_EMPTY',
      'The CSV must contain the versioned header and at least one data row.',
    );
  }
  if (rows.length - 1 > DELIVERY_STATUS_CSV_MAX_ROWS) {
    throw new DeliveryCsvError(
      'DELIVERY_CSV_ROW_LIMIT',
      `The CSV exceeds the ${DELIVERY_STATUS_CSV_MAX_ROWS}-row limit.`,
    );
  }
  const header = rows[0]!;
  if (
    header.length !== DELIVERY_STATUS_CSV_HEADERS.length ||
    header.some((value, index) => value !== DELIVERY_STATUS_CSV_HEADERS[index])
  ) {
    throw new DeliveryCsvError(
      'DELIVERY_CSV_HEADER_INVALID',
      `The CSV header must exactly match ${DELIVERY_STATUS_CSV_HEADERS.join(',')}.`,
      1,
    );
  }

  const deliveryIds = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const row = index + 2;
    if (values.length !== DELIVERY_STATUS_CSV_HEADERS.length) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_COLUMN_COUNT_INVALID',
        `Row ${row} does not contain the required number of columns.`,
        row,
      );
    }
    const [
      schemaVersion,
      deliveryId,
      expectedVersionValue,
      currentStatus,
      targetStatus,
      reasonCode,
      note,
    ] = values as [string, string, string, string, string, string, string, ...string[]];
    if (schemaVersion !== DELIVERY_STATUS_CSV_SCHEMA) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_SCHEMA_UNSUPPORTED',
        `Row ${row} does not use ${DELIVERY_STATUS_CSV_SCHEMA}.`,
        row,
      );
    }
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(deliveryId)) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_DELIVERY_ID_INVALID',
        `Row ${row} has an invalid delivery identifier.`,
        row,
      );
    }
    if (deliveryIds.has(deliveryId)) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_DUPLICATE_DELIVERY',
        `Row ${row} repeats delivery ${deliveryId}.`,
        row,
      );
    }
    deliveryIds.add(deliveryId);
    if (!/^[1-9]\d{0,9}$/.test(expectedVersionValue)) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_VERSION_INVALID',
        `Row ${row} has an invalid expected version.`,
        row,
      );
    }
    if (!Object.values(DeliveryStatus).includes(currentStatus as DeliveryStatus)) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_CURRENT_STATUS_INVALID',
        `Row ${row} has an invalid current status.`,
        row,
      );
    }
    if (!(OPERATIONAL_DELIVERY_TARGETS as readonly string[]).includes(targetStatus)) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_TARGET_STATUS_INVALID',
        `Row ${row} has a target that is not allowed through operational CSV import.`,
        row,
      );
    }
    if (reasonCode.length > 80 || (reasonCode.length > 0 && !/^[A-Z0-9_-]+$/.test(reasonCode))) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_REASON_CODE_INVALID',
        `Row ${row} has an invalid reason code.`,
        row,
      );
    }
    if (note.length > 1000) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_NOTE_TOO_LONG',
        `Row ${row} has a note longer than 1000 characters.`,
        row,
      );
    }
    return {
      row,
      deliveryId,
      expectedVersion: Number(expectedVersionValue),
      currentStatus: currentStatus as DeliveryStatus,
      targetStatus: targetStatus as DeliveryStatusCsvCommand['targetStatus'],
      reasonCode: reasonCode || null,
      note: note.trim() || null,
    };
  });
};

const parseCsvRows = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;

  const finishCell = () => {
    if (cell.length > 2000) {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_CELL_TOO_LARGE',
        'A CSV cell exceeds 2000 characters.',
      );
    }
    row.push(cell);
    cell = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new DeliveryCsvError(
        'DELIVERY_CSV_QUOTE_INVALID',
        'Unexpected content appears after a closing quote.',
      );
    }
    if (character === '"') {
      if (cell.length > 0) {
        throw new DeliveryCsvError('DELIVERY_CSV_QUOTE_INVALID', 'A quote starts inside a cell.');
      }
      quoted = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n') {
      finishRow();
    } else if (character === '\r') {
      if (input[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new DeliveryCsvError('DELIVERY_CSV_QUOTE_INVALID', 'The CSV contains an unclosed quote.');
  }
  if (cell.length > 0 || row.length > 0) finishRow();
  return rows;
};

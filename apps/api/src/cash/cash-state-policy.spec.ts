import { CashCollectionStatus, CashDiscrepancyStatus, CashRemittanceStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canTransitionCollection,
  canTransitionDiscrepancy,
  canTransitionRemittance,
  CASH_COLLECTION_TRANSITIONS,
  CASH_DISCREPANCY_TRANSITIONS,
  CASH_REMITTANCE_TRANSITIONS,
} from './cash-state-policy';

describe('COD state policies', () => {
  it('defines every Prisma state and keeps terminal states closed', () => {
    expect(Object.keys(CASH_COLLECTION_TRANSITIONS).sort()).toEqual(
      Object.values(CashCollectionStatus).sort(),
    );
    expect(Object.keys(CASH_REMITTANCE_TRANSITIONS).sort()).toEqual(
      Object.values(CashRemittanceStatus).sort(),
    );
    expect(Object.keys(CASH_DISCREPANCY_TRANSITIONS).sort()).toEqual(
      Object.values(CashDiscrepancyStatus).sort(),
    );
    expect(CASH_COLLECTION_TRANSITIONS.REMITTED).toEqual([]);
    expect(CASH_REMITTANCE_TRANSITIONS.VERIFIED).toEqual([]);
    expect(CASH_DISCREPANCY_TRANSITIONS.RESOLVED).toEqual([]);
  });

  it('allows only explicit custody and reconciliation transitions', () => {
    expect(
      canTransitionCollection(CashCollectionStatus.EXPECTED, CashCollectionStatus.COLLECTED),
    ).toBe(true);
    expect(canTransitionRemittance(CashRemittanceStatus.DRAFT, CashRemittanceStatus.VERIFIED)).toBe(
      false,
    );
    expect(
      canTransitionDiscrepancy(CashDiscrepancyStatus.OPEN, CashDiscrepancyStatus.WRITTEN_OFF),
    ).toBe(true);
  });
});

import { CashCollectionStatus, CashDiscrepancyStatus, CashRemittanceStatus } from '@prisma/client';

export const CASH_COLLECTION_TRANSITIONS = {
  EXPECTED: [CashCollectionStatus.COLLECTED, CashCollectionStatus.PARTIALLY_COLLECTED],
  COLLECTED: [CashCollectionStatus.REMITTED],
  PARTIALLY_COLLECTED: [CashCollectionStatus.REMITTED],
  VOIDED: [],
  REMITTED: [],
} as const satisfies Record<CashCollectionStatus, readonly CashCollectionStatus[]>;

export const CASH_REMITTANCE_TRANSITIONS = {
  DRAFT: [CashRemittanceStatus.SUBMITTED],
  SUBMITTED: [CashRemittanceStatus.VERIFIED, CashRemittanceStatus.DISCREPANCY],
  VERIFIED: [],
  DISCREPANCY: [CashRemittanceStatus.VERIFIED],
  REJECTED: [],
  CANCELLED: [],
} as const satisfies Record<CashRemittanceStatus, readonly CashRemittanceStatus[]>;

export const CASH_DISCREPANCY_TRANSITIONS = {
  OPEN: [
    CashDiscrepancyStatus.INVESTIGATING,
    CashDiscrepancyStatus.RESOLVED,
    CashDiscrepancyStatus.WRITTEN_OFF,
  ],
  INVESTIGATING: [CashDiscrepancyStatus.RESOLVED, CashDiscrepancyStatus.WRITTEN_OFF],
  RESOLVED: [],
  WRITTEN_OFF: [],
} as const satisfies Record<CashDiscrepancyStatus, readonly CashDiscrepancyStatus[]>;

export const canTransitionCollection = (
  from: CashCollectionStatus,
  to: CashCollectionStatus,
): boolean => (CASH_COLLECTION_TRANSITIONS[from] as readonly CashCollectionStatus[]).includes(to);

export const canTransitionRemittance = (
  from: CashRemittanceStatus,
  to: CashRemittanceStatus,
): boolean => (CASH_REMITTANCE_TRANSITIONS[from] as readonly CashRemittanceStatus[]).includes(to);

export const canTransitionDiscrepancy = (
  from: CashDiscrepancyStatus,
  to: CashDiscrepancyStatus,
): boolean => (CASH_DISCREPANCY_TRANSITIONS[from] as readonly CashDiscrepancyStatus[]).includes(to);

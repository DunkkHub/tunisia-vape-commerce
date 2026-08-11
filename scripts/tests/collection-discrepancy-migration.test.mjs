import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../prisma/migrations/20260804130000_collection_discrepancy_scope/migration.sql',
  import.meta.url,
);

const validScope = ({ remittanceId, orderId, cashCollectionId }) =>
  (remittanceId !== null && orderId === null && cashCollectionId === null) ||
  (remittanceId === null && orderId !== null);

const legacyBackfillFixture = ({ eventClaims, amountCandidates }) => {
  if (eventClaims.length > 0) {
    return eventClaims.every(
      (claim) => claim.valid && claim.collectionId === eventClaims[0].collectionId,
    )
      ? eventClaims[0].collectionId
      : null;
  }
  return amountCandidates.length === 1 ? amountCandidates[0] : null;
};

const discardCrossDiscrepancyClaims = (claims) => {
  const claimCounts = new Map();
  for (const { collectionId } of claims) {
    if (collectionId !== null)
      claimCounts.set(collectionId, (claimCounts.get(collectionId) ?? 0) + 1);
  }
  return claims.map((claim) => ({
    ...claim,
    collectionId:
      claim.collectionId !== null && claimCounts.get(claim.collectionId) === 1
        ? claim.collectionId
        : null,
  }));
};

test('collection discrepancy migration encodes the resolvable scope truth table', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(
    sql,
    /`remittanceId` IS NOT NULL AND `orderId` IS NULL AND `cashCollectionId` IS NULL/,
  );
  assert.match(sql, /`remittanceId` IS NULL AND `orderId` IS NOT NULL/);

  assert.equal(
    validScope({ remittanceId: 'remittance-1', orderId: null, cashCollectionId: null }),
    true,
  );
  assert.equal(
    validScope({ remittanceId: null, orderId: 'legacy-order', cashCollectionId: null }),
    true,
  );
  assert.equal(
    validScope({ remittanceId: null, orderId: 'order-1', cashCollectionId: 'collection-1' }),
    true,
  );
  assert.equal(validScope({ remittanceId: null, orderId: null, cashCollectionId: null }), false);
  assert.equal(
    validScope({ remittanceId: 'remittance-1', orderId: 'order-1', cashCollectionId: null }),
    false,
  );
  assert.equal(
    validScope({ remittanceId: 'remittance-1', orderId: null, cashCollectionId: 'collection-1' }),
    false,
  );
});

test('legacy backfill fixtures prefer validated event coordinates and fail closed on conflicts', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'DISCREPANCY_OPENED'/);
  assert.match(sql, /\$\.discrepancyId/);
  assert.match(sql, /COUNT\(DISTINCT collection\.`id`\) = 1/);
  assert.match(sql, /NOT EXISTS[\s\S]*'DISCREPANCY_OPENED'/);
  assert.match(sql, /CREATE TEMPORARY TABLE `_migration_collection_discrepancy_conflicts`/);
  assert.match(sql, /GROUP BY discrepancy\.`cashCollectionId`[\s\S]*HAVING COUNT\(\*\) > 1/);
  assert.match(
    sql,
    /JOIN `_migration_collection_discrepancy_conflicts` conflict[\s\S]*SET discrepancy\.`cashCollectionId` = NULL/,
  );
  assert.equal((sql.match(/reconciliation_event\.`remittanceId` IS NULL/g) ?? []).length, 2);
  assert.match(sql, /NOT \(`remittanceId` IS NOT NULL AND `cashCollectionId` IS NOT NULL\)/);
  const executableSql = sql.replace(/^--.*$/gm, '');
  assert.doesNotMatch(executableSql, /ON UPDATE CASCADE/);
  assert.equal((executableSql.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length, 5);

  assert.equal(
    legacyBackfillFixture({
      eventClaims: [{ collectionId: 'same-amount-collection-2', valid: true }],
      amountCandidates: ['same-amount-collection-1', 'same-amount-collection-2'],
    }),
    'same-amount-collection-2',
  );
  assert.equal(
    legacyBackfillFixture({
      eventClaims: [
        { collectionId: 'collection-1', valid: true },
        { collectionId: 'collection-2', valid: true },
      ],
      amountCandidates: ['collection-1'],
    }),
    null,
  );
  assert.equal(
    legacyBackfillFixture({
      eventClaims: [{ collectionId: 'collection-1', valid: false }],
      amountCandidates: ['collection-1'],
    }),
    null,
  );
  assert.equal(
    legacyBackfillFixture({ eventClaims: [], amountCandidates: ['unique-fallback'] }),
    'unique-fallback',
  );
  assert.deepEqual(
    discardCrossDiscrepancyClaims([
      { discrepancyId: 'discrepancy-1', collectionId: 'collection-shared' },
      { discrepancyId: 'discrepancy-2', collectionId: 'collection-shared' },
      { discrepancyId: 'discrepancy-3', collectionId: 'collection-unique' },
    ]),
    [
      { discrepancyId: 'discrepancy-1', collectionId: null },
      { discrepancyId: 'discrepancy-2', collectionId: null },
      { discrepancyId: 'discrepancy-3', collectionId: 'collection-unique' },
    ],
  );
});

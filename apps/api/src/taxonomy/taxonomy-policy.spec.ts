import { PublicationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { statusBecomesNonPublic, taxonomySortOrder } from './taxonomy-policy';

describe('taxonomy state policy', () => {
  it('detects every transition that would make a published taxonomy record non-public', () => {
    expect(statusBecomesNonPublic(PublicationStatus.PUBLISHED, 'DRAFT')).toBe(true);
    expect(statusBecomesNonPublic(PublicationStatus.PUBLISHED, 'SUSPENDED')).toBe(true);
    expect(statusBecomesNonPublic(PublicationStatus.PUBLISHED, 'ARCHIVED')).toBe(true);
    expect(statusBecomesNonPublic(PublicationStatus.PUBLISHED, 'PUBLISHED')).toBe(false);
    expect(statusBecomesNonPublic(PublicationStatus.DRAFT, 'ARCHIVED')).toBe(false);
  });

  it('produces only allowlisted deterministic sort expressions', () => {
    expect(taxonomySortOrder('name_asc', 'nameFr')).toEqual([{ nameFr: 'asc' }, { id: 'asc' }]);
    expect(taxonomySortOrder('updated_desc', 'name')).toEqual([
      { updatedAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});

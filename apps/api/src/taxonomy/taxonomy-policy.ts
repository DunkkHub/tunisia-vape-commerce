import type { PublicationStatus } from '@prisma/client';
import type { MutableTaxonomyStatus } from './dto/taxonomy.dto';

export const statusBecomesNonPublic = (
  current: PublicationStatus,
  target: MutableTaxonomyStatus | 'ARCHIVED',
): boolean => current === 'PUBLISHED' && target !== 'PUBLISHED';

export const taxonomySortOrder = (
  sort: 'name_asc' | 'name_desc' | 'updated_desc',
  nameField: 'name' | 'nameFr',
): Array<Record<string, 'asc' | 'desc'>> => {
  if (sort === 'updated_desc') return [{ updatedAt: 'desc' }, { id: 'desc' }];
  return [{ [nameField]: sort === 'name_desc' ? 'desc' : 'asc' }, { id: 'asc' }];
};

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../prisma/migrations/20260811170000_product_image_renditions/migration.sql',
  import.meta.url,
);

test('product-image rendition metadata is immutable, bounded, and owner-scoped', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /CREATE TABLE `ProductImageRendition`/u);
  assert.match(sql, /PRIMARY KEY \(`productImageId`, `name`, `format`, `profileVersion`\)/u);
  assert.match(
    sql,
    /CHECK \(\(`name` COLLATE utf8mb4_bin\) IN \('thumbnail', 'card', 'detail', 'high-resolution'\)\)/u,
  );
  assert.match(sql, /CHECK \(\(`format` COLLATE utf8mb4_bin\) IN \('webp', 'jpeg'\)\)/u);
  assert.match(sql, /CHECK \(`profileVersion` > 0\)/u);
  assert.match(sql, /CHECK \(`byteSize` > 0 AND `byteSize` <= 10485760\)/u);
  assert.match(
    sql,
    /CHECK \(\(`checksumSha256` COLLATE utf8mb4_bin\) REGEXP '\^\[a-f0-9\]\{64\}\$'\)/u,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(`productImageId`\) REFERENCES `ProductImage` \(`id`\)[\s\S]*ON DELETE RESTRICT ON UPDATE RESTRICT/u,
  );
  assert.doesNotMatch(sql, /UPDATE `ProductImage`|DELETE FROM `ProductImage`/u);
});

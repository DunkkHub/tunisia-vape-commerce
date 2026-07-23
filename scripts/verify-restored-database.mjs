import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyRestoredDatabase } from './lib/restore-verification.mjs';

const databaseUrl = process.env.DATABASE_RESTORE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_RESTORE_URL or DATABASE_URL is required');
if (!process.env.EXPECTED_MIGRATION_NAME) {
  throw new Error('EXPECTED_MIGRATION_NAME is required for restore verification');
}
process.env.DATABASE_URL = databaseUrl;
const manifestArgument = process.argv[2];
const manifest = manifestArgument
  ? JSON.parse(await readFile(path.resolve(manifestArgument), 'utf8'))
  : null;
const prisma = new PrismaClient();
try {
  const result = await verifyRestoredDatabase(prisma, manifest, {
    expectedMigration: process.env.EXPECTED_MIGRATION_NAME,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}

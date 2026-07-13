import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const parsed = new URL(databaseUrl);
const expectedUser = process.env.DB_RUNTIME_USER_EXPECTED ?? 'app_user';
if (parsed.protocol !== 'mysql:' || decodeURIComponent(parsed.username) !== expectedUser) {
  throw new Error('DATABASE_URL must identify the expected MySQL runtime user');
}

const prisma = new PrismaClient();
const table = `__runtime_ddl_probe_${randomBytes(8).toString('hex')}`;
let unexpectedlyCreated = false;
try {
  // The identifier is generated locally from hexadecimal bytes. This deliberate DDL probe proves
  // the runtime identity cannot create schema objects; it is never derived from external input.
  await prisma.$executeRawUnsafe(`CREATE TABLE \`${table}\` (\`id\` INTEGER NOT NULL)`);
  unexpectedlyCreated = true;
} catch (error) {
  const databaseCode =
    typeof error === 'object' &&
    error !== null &&
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'code' in error.meta
      ? String(error.meta.code)
      : null;
  if (databaseCode !== '1142') {
    throw new Error('Runtime DDL probe failed unexpectedly', { cause: error });
  }
  process.stdout.write('Runtime database identity correctly denied CREATE.\n');
} finally {
  if (unexpectedlyCreated) {
    await prisma.$executeRawUnsafe(`DROP TABLE \`${table}\``).catch(() => undefined);
  }
  await prisma.$disconnect();
}

if (unexpectedlyCreated) {
  throw new Error('Runtime database identity has forbidden CREATE privilege');
}

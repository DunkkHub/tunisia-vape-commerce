import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../cache/redis.service';
import { CatalogMediaImportService } from '../catalog-import/catalog-media-import.service';
import { validateEnvironment, type Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { ProductImageValidatorService } from '../product-media/product-image-validator.service';
import { ProductMediaService } from '../product-media/product-media.service';
import { LocalMediaStorage } from '../product-media/storage/local-media-storage';
import type { MediaStorage } from '../product-media/storage/media-storage';
import { S3MediaStorage } from '../product-media/storage/s3-media-storage';

const argumentValue = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const help = `Usage: pnpm catalog:media:wotofo -- --batch-id <id> --actor-email <admin@example.tld> [--json]

Downloads only allowlisted official Wotofo assets, validates and safely re-encodes them through the
product-media service, records provenance, and leaves products in DRAFT for price and stock review.
`;

const mediaStorage = (config: ConfigService<Environment, true>): MediaStorage => {
  if (config.get('MEDIA_STORAGE_DRIVER', { infer: true }) === 'local') {
    return new LocalMediaStorage(config.get('MEDIA_LOCAL_ROOT', { infer: true }));
  }
  const endpoint = config.get('S3_ENDPOINT', { infer: true });
  const accessKey = config.get('S3_ACCESS_KEY', { infer: true });
  const secretKey = config.get('S3_SECRET_KEY', { infer: true });
  return new S3MediaStorage({
    region: config.get('S3_REGION', { infer: true }),
    bucket: config.get('S3_BUCKET', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    ...(endpoint ? { endpoint } : {}),
    ...(accessKey ? { accessKey } : {}),
    ...(secretKey ? { secretKey } : {}),
  });
};

const run = async () => {
  if (process.argv.includes('--help')) {
    process.stdout.write(help);
    return;
  }
  const batchId = argumentValue('--batch-id') ?? '';
  const actorEmail = (
    argumentValue('--actor-email') ??
    process.env.CATALOG_IMPORT_ACTOR_EMAIL ??
    ''
  )
    .trim()
    .toLowerCase();
  if (!batchId || !actorEmail) throw new Error('--batch-id and --actor-email are required.');

  const environment = validateEnvironment(process.env);
  const config = new ConfigService<Environment, true>(environment);
  const prisma = new PrismaService();
  const storage = mediaStorage(config);
  const redis = new RedisService(config);
  await prisma.$connect();
  try {
    const validator = new ProductImageValidatorService(config);
    const media = new ProductMediaService(prisma, validator, storage);
    const mediaImports = new CatalogMediaImportService(prisma, config, media, redis);
    const administrator = await prisma.user.findFirst({
      where: {
        audience: 'ADMIN',
        emailNormalized: actorEmail,
        status: 'ACTIVE',
        deletedAt: null,
        adminProfile: { is: { suspendedAt: null } },
      },
      select: {
        id: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    const permissions = new Set(
      administrator?.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.key),
      ) ?? [],
    );
    if (!administrator || !permissions.has('catalog.import')) {
      throw new Error('The actor must be an active administrator with catalog.import permission.');
    }
    const result = await mediaImports.importWotofo(batchId, {
      userId: administrator.id,
      requestId: `cli:wotofo-media:${randomUUID()}`,
      ipAddress: '127.0.0.1',
      userAgent: 'catalog-media-wotofo-cli',
    });
    process.stdout.write(
      `${JSON.stringify(result.data, null, process.argv.includes('--json') ? 0 : 2)}\n`,
    );
  } finally {
    redis.onModuleDestroy();
    if (storage instanceof S3MediaStorage) storage.onModuleDestroy();
    await prisma.$disconnect();
  }
};

run().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message || error.name : 'The Wotofo media import failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

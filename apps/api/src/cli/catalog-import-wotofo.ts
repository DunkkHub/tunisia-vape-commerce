import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CatalogImportService } from '../catalog-import/catalog-import.service';
import { WOTOFO_SOURCE_VERIFIED_AT } from '../catalog-import/wotofo-catalog';
import { fetchWotofoImportRows } from '../catalog-import/wotofo-import-data';
import type { PrismaService } from '../database/prisma.service';

interface Arguments {
  actorEmail: string;
  apply: boolean;
  importKey: string;
  json: boolean;
}

const help = `Usage: pnpm catalog:import:wotofo -- --actor-email <admin@example.tld> [options]

Verifies the reviewed manifest against live official Wotofo product endpoints, records a dry run,
and only applies draft catalogue records when --apply is explicitly supplied.

Options:
  --actor-email <email>  Existing active administrator with catalog.import permission.
  --import-key <key>     Idempotency key (default: reviewed source date and schema version).
  --apply                Apply the unchanged server-side preview atomically.
  --json                 Print machine-readable JSON.
  --help                 Show this help.
`;

const argumentValue = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const parseArguments = (): Arguments => {
  if (process.argv.includes('--help')) {
    process.stdout.write(help);
    process.exit(0);
  }
  const actorEmail = argumentValue('--actor-email') ?? process.env.CATALOG_IMPORT_ACTOR_EMAIL ?? '';
  if (!actorEmail) throw new Error('--actor-email is required.');
  const importKey =
    argumentValue('--import-key') ?? `wotofo-${WOTOFO_SOURCE_VERIFIED_AT.slice(0, 10)}-catalog-v1`;
  return {
    actorEmail: actorEmail.trim().toLowerCase(),
    apply: process.argv.includes('--apply'),
    importKey,
    json: process.argv.includes('--json'),
  };
};

const run = async () => {
  const input = parseArguments();
  const prisma = new PrismaClient();
  try {
    const administrator = await prisma.user.findFirst({
      where: {
        audience: 'ADMIN',
        emailNormalized: input.actorEmail,
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
    const { rows, sources } = await fetchWotofoImportRows();
    const service = new CatalogImportService(prisma as unknown as PrismaService);
    const actor = {
      userId: administrator.id,
      requestId: `cli:wotofo-import:${randomUUID()}`,
      ipAddress: '127.0.0.1',
      userAgent: 'catalog-import-wotofo-cli',
    };
    const preview = await service.preview(
      {
        schemaVersion: '1.0',
        rows: rows.map((row, index) => ({ rowNumber: index + 1, input: row, issues: [] })),
      },
      {
        importKey: input.importKey,
        format: 'WOTOFO',
        source: 'WOTOFO_OFFICIAL',
        partialMode: false,
        overridePrice: false,
        overrideStatus: false,
        overrideImages: false,
      },
      actor,
    );
    const result = input.apply ? await service.apply(preview.data.id, actor) : preview;
    const output = {
      mode: input.apply ? 'apply' : 'dry-run',
      officialProductsVerified: sources.length,
      reviewedRows: rows.length,
      import: result.data,
      nextStep: input.apply
        ? 'Import verified media, then enter real price and stock before publication.'
        : 'Review this receipt and rerun with --apply to create draft records.',
    };
    process.stdout.write(`${JSON.stringify(output, null, input.json ? 0 : 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error: unknown) => {
  const safe = error instanceof Error ? error.message : 'The Wotofo catalogue import failed.';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
});

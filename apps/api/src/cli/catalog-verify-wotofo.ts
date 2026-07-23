import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { WOTOFO_PRODUCTS } from '../catalog-import/wotofo-catalog';
import {
  buildWotofoVerificationReport,
  type WotofoVerificationProduct,
} from '../catalog-import/wotofo-verification';

const argumentValue = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const findRepositoryRoot = (startDirectory: string): string => {
  let currentDirectory = resolve(startDirectory);
  const filesystemRoot = parse(currentDirectory).root;
  while (true) {
    if (existsSync(join(currentDirectory, 'pnpm-workspace.yaml'))) {
      return currentDirectory;
    }
    if (currentDirectory === filesystemRoot) {
      throw new Error('Unable to locate the repository root.');
    }
    currentDirectory = dirname(currentDirectory);
  }
};

const run = async () => {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: pnpm catalog:verify:wotofo -- [--json] [--output outputs/catalog/wotofo-verification.json]\n',
    );
    return;
  }
  const requestedOutput = argumentValue('--output') ?? 'outputs/catalog/wotofo-verification.json';
  const outputPath = isAbsolute(requestedOutput)
    ? requestedOutput
    : resolve(findRepositoryRoot(process.cwd()), requestedOutput);
  const expectedKeys = WOTOFO_PRODUCTS.map(({ key }) => key);
  const prisma = new PrismaClient();
  try {
    const sources = await prisma.catalogSourceRecord.findMany({
      where: {
        source: 'WOTOFO_OFFICIAL',
        entityType: 'PRODUCT',
        externalKey: { in: expectedKeys },
        productId: { not: null },
      },
      orderBy: { externalKey: 'asc' },
      include: {
        product: {
          include: {
            images: {
              where: { deletedAt: null, moderationStatus: 'APPROVED' },
              select: {
                id: true,
                sourceRecords: {
                  where: { source: 'WOTOFO_OFFICIAL', entityType: 'IMAGE' },
                  select: { id: true },
                },
              },
            },
            variants: {
              where: { deletedAt: null },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: {
                flavor: true,
                inventoryItems: {
                  select: {
                    onHandQuantity: true,
                    reservations: {
                      where: { state: 'ACTIVE', expiresAt: { gt: new Date() } },
                      select: { quantity: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const products: WotofoVerificationProduct[] = sources.flatMap((source) => {
      if (!source.product) return [];
      const product = source.product;
      return [
        {
          sourceKey: source.externalKey,
          sourceUrl: source.sourceUrl,
          sourceVerifiedAt: source.verifiedAt?.toISOString() ?? '',
          slug: product.slug,
          nameFr: product.nameFr,
          nameAr: product.nameAr,
          status: product.publicationStatus,
          requiresPricing: product.requiresPricing,
          requiresStock: product.requiresStock,
          needsMediaReview: product.needsMediaReview,
          approvedImageCount: product.images.length,
          verifiedImageSourceCount: product.images.filter(
            ({ sourceRecords }) => sourceRecords.length > 0,
          ).length,
          variants: product.variants.map((variant) => ({
            sku: variant.sku,
            flavorCanonical: variant.flavor?.canonicalName ?? null,
            flavorNameFr: variant.flavor?.nameFr ?? null,
            flavorNameAr: variant.flavor?.nameAr ?? null,
            color: variant.color,
            priceMillimes: variant.priceMillimes,
            availableQuantity: variant.inventoryItems.reduce(
              (total, inventory) =>
                total +
                Math.max(
                  0,
                  inventory.onHandQuantity -
                    inventory.reservations.reduce(
                      (sum, reservation) => sum + reservation.quantity,
                      0,
                    ),
                ),
              0,
            ),
          })),
        },
      ];
    });
    const report = buildWotofoVerificationReport(products);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
    });
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(
        [
          `Wotofo catalogue: ${report.actualProductCount}/${report.expectedProductCount} products`,
          `Variants: ${report.actualVariantCount}/${report.expectedVariantCount}`,
          `Products requiring price entry: ${report.productsRequiringPricing.length}`,
          `Products requiring stock entry: ${report.productsRequiringStock.length}`,
          `Products requiring media review: ${report.productsRequiringMediaReview.length}`,
          `Structural result: ${report.valid ? 'PASS' : 'FAIL'}`,
          `JSON report: ${outputPath}`,
          ...report.structuralErrors.map((error) => `- ${error}`),
        ].join('\n') + '\n',
      );
    }
    if (!report.valid) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Wotofo catalogue verification failed.'}\n`,
  );
  process.exitCode = 1;
});

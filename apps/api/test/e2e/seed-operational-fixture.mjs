import argon2, { argon2id } from 'argon2';
import { PrismaClient } from '@prisma/client';

const CONFIRMATION = 'CREATE_DISPOSABLE_OPERATIONAL_E2E_FIXTURE';
const DATABASE_NAME_PATTERN = /^vape_e2e_[a-z0-9_]+$/;

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

if (process.env.NODE_ENV !== 'test') {
  throw new Error('The operational E2E fixture is available only when NODE_ENV=test');
}
if (process.env.OPERATIONAL_E2E_FIXTURE_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OPERATIONAL_E2E_FIXTURE_CONFIRM=${CONFIRMATION} exactly`);
}

const databaseName = required('OPERATIONAL_E2E_DATABASE_NAME');
if (!DATABASE_NAME_PATTERN.test(databaseName)) {
  throw new Error('OPERATIONAL_E2E_DATABASE_NAME must identify a generated disposable database');
}
const databaseUrl = new URL(required('DATABASE_URL'));
if (databaseUrl.protocol !== 'mysql:' || databaseUrl.pathname !== `/${databaseName}`) {
  throw new Error('DATABASE_URL must point at the confirmed disposable operational E2E database');
}

const adminEmail = required('OPERATIONAL_E2E_ADMIN_EMAIL').toLocaleLowerCase('en-US');
const adminPassword = required('OPERATIONAL_E2E_ADMIN_PASSWORD');
const reconcilerEmail = required('OPERATIONAL_E2E_RECONCILER_EMAIL').toLocaleLowerCase('en-US');
const reconcilerPassword = required('OPERATIONAL_E2E_RECONCILER_PASSWORD');
const limitedAdminEmail = required('OPERATIONAL_E2E_LIMITED_ADMIN_EMAIL').toLocaleLowerCase(
  'en-US',
);
const limitedAdminPassword = required('OPERATIONAL_E2E_LIMITED_ADMIN_PASSWORD');
for (const [name, password] of [
  ['OPERATIONAL_E2E_ADMIN_PASSWORD', adminPassword],
  ['OPERATIONAL_E2E_RECONCILER_PASSWORD', reconcilerPassword],
  ['OPERATIONAL_E2E_LIMITED_ADMIN_PASSWORD', limitedAdminPassword],
]) {
  if (password.length < 14 || password.length > 128) {
    throw new Error(`${name} must contain 14-128 characters`);
  }
}

const prisma = new PrismaClient();

try {
  const [userCount, productCount, superAdministratorRole, accountantRole, readOnlyRole, tunis] =
    await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.role.findUnique({ where: { key: 'super-administrator' }, select: { id: true } }),
      prisma.role.findUnique({ where: { key: 'accountant' }, select: { id: true } }),
      prisma.role.findUnique({ where: { key: 'read-only-analyst' }, select: { id: true } }),
      prisma.governorate.findUnique({ where: { code: '11' }, select: { id: true } }),
    ]);
  if (userCount !== 0 || productCount !== 0) {
    throw new Error('The operational E2E fixture requires a clean structural seed');
  }
  if (!superAdministratorRole || !accountantRole || !readOnlyRole || !tunis) {
    throw new Error('Run the structural seed before creating the operational E2E fixture');
  }

  const hashPassword = (password) =>
    argon2.hash(password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 3,
      parallelism: 1,
    });
  const [adminPasswordHash, reconcilerPasswordHash, limitedAdminPasswordHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(reconcilerPassword),
    hashPassword(limitedAdminPassword),
  ]);

  const result = await prisma.$transaction(async (transaction) => {
    const settingUpdates = await Promise.all([
      transaction.storeSetting.update({
        where: { key: 'checkout.enabled' },
        data: { value: true },
      }),
      transaction.storeSetting.update({
        where: { key: 'maintenance.mode' },
        data: { value: false },
      }),
      transaction.storeSetting.update({
        where: { key: 'prelaunch.mode' },
        data: { value: false },
      }),
      transaction.storeSetting.update({
        where: { key: 'store.name' },
        data: { value: 'Operational E2E Store' },
      }),
      transaction.storeSetting.update({
        where: { key: 'store.phone' },
        data: { value: '+21670000000' },
      }),
      transaction.storeSetting.update({
        where: { key: 'store.email' },
        data: { value: 'operations@example.test' },
      }),
      transaction.storeSetting.update({
        where: { key: 'store.address' },
        data: { value: 'Tunis disposable E2E facility' },
      }),
      transaction.complianceSetting.update({
        where: { key: 'minimum_purchase_age' },
        data: { value: 18 },
      }),
      transaction.complianceSetting.update({
        where: { key: 'age_gate.entry.enabled' },
        data: { value: true },
      }),
      transaction.complianceSetting.update({
        where: { key: 'age_gate.checkout.enabled' },
        data: { value: true },
      }),
      transaction.complianceSetting.update({
        where: { key: 'consent.terms.required' },
        data: { value: true },
      }),
      transaction.complianceSetting.update({
        where: { key: 'consent.privacy.required' },
        data: { value: true },
      }),
      transaction.complianceSetting.update({
        where: { key: 'consent.recording.enabled' },
        data: { value: true },
      }),
    ]);
    if (settingUpdates.length !== 13) throw new Error('Fixture settings were not initialized');

    const admin = await transaction.user.create({
      data: {
        audience: 'ADMIN',
        email: adminEmail,
        emailNormalized: adminEmail,
        passwordHash: adminPasswordHash,
        status: 'ACTIVE',
        adminProfile: {
          create: {
            displayName: 'Operational E2E Administrator',
            employeeCode: 'E2E-ADMIN',
            jobTitle: 'Disposable test administrator',
            mustEnrollTwoFactor: true,
            invitationAcceptedAt: new Date(),
          },
        },
        roles: { create: { roleId: superAdministratorRole.id } },
      },
      select: { id: true },
    });

    await transaction.user.create({
      data: {
        audience: 'ADMIN',
        email: reconcilerEmail,
        emailNormalized: reconcilerEmail,
        passwordHash: reconcilerPasswordHash,
        status: 'ACTIVE',
        adminProfile: {
          create: {
            displayName: 'Operational E2E Reconciler',
            employeeCode: 'E2E-RECONCILER',
            jobTitle: 'Disposable independent cash verifier',
            mustEnrollTwoFactor: true,
            invitationAcceptedAt: new Date(),
          },
        },
        roles: { create: { roleId: accountantRole.id } },
      },
    });

    await transaction.user.create({
      data: {
        audience: 'ADMIN',
        email: limitedAdminEmail,
        emailNormalized: limitedAdminEmail,
        passwordHash: limitedAdminPasswordHash,
        status: 'ACTIVE',
        adminProfile: {
          create: {
            displayName: 'Operational E2E Read-only Analyst',
            employeeCode: 'E2E-READONLY',
            jobTitle: 'Disposable permission-denial verifier',
            mustEnrollTwoFactor: true,
            invitationAcceptedAt: new Date(),
          },
        },
        roles: { create: { roleId: readOnlyRole.id } },
      },
    });

    const delegation = await transaction.delegation.create({
      data: {
        governorateId: tunis.id,
        code: 'E2E-TUNIS',
        nameFr: 'Délégation E2E',
        nameAr: 'منطقة اختبار E2E',
        active: true,
      },
    });
    const locality = await transaction.locality.create({
      data: {
        delegationId: delegation.id,
        code: 'E2E-LOCALITY',
        nameFr: 'Localité E2E',
        nameAr: 'محلية اختبار E2E',
        active: true,
      },
    });
    await transaction.postalCode.create({
      data: { localityId: locality.id, code: '1001', active: true },
    });

    const zone = await transaction.deliveryZone.create({
      data: {
        code: 'E2E-COURIER',
        nameFr: 'Livraison E2E',
        nameAr: 'توصيل اختبار E2E',
        priority: 100,
        active: true,
        supported: true,
        temporarilySuspended: false,
        minOrderMillimes: 1_000,
        maxCodMillimes: 500_000,
        estimatedMinDays: 1,
        estimatedMaxDays: 2,
        localities: { create: { localityId: locality.id, active: true } },
        rates: {
          create: {
            type: 'BASE',
            name: 'Operational E2E base rate',
            priority: 100,
            feeMillimes: 7_000,
            active: true,
          },
        },
      },
      select: { id: true },
    });

    const category = await transaction.category.create({
      data: {
        nameFr: 'Jetables E2E',
        nameAr: 'منتجات اختبار E2E',
        slug: 'jetables-e2e',
        publicationStatus: 'PUBLISHED',
      },
    });
    const brand = await transaction.brand.create({
      data: {
        name: 'PuffJet E2E',
        slug: 'puffjet-e2e',
        publicationStatus: 'PUBLISHED',
      },
    });
    const product = await transaction.product.create({
      data: {
        brandId: brand.id,
        categoryId: category.id,
        nameFr: 'PuffJet Menthe Opérationnelle',
        nameAr: 'باف جيت نعناع اختبار',
        slug: 'puffjet-menthe-operationnelle',
        sku: 'E2E-PUFFJET-MINT',
        productType: 'DISPOSABLE',
        shortDescriptionFr: 'Produit publié uniquement dans la base E2E jetable.',
        shortDescriptionAr: 'منتج منشور فقط في قاعدة اختبار مؤقتة.',
        containsNicotine: true,
        nicotineStrengthMg: 5,
        flavor: 'Menthe E2E',
        puffCount: 6_000,
        baseCostMillimes: 5_000,
        basePriceMillimes: 10_000,
        taxRateBps: 1_900,
        warningFr: 'Produit réservé aux adultes.',
        warningAr: 'منتج مخصص للبالغين.',
        minimumAge: 18,
        publicationStatus: 'PUBLISHED',
        featured: true,
        publishedAt: new Date(Date.now() - 60_000),
        variants: {
          create: {
            nameFr: 'Menthe E2E',
            nameAr: 'نعناع E2E',
            sku: 'E2E-PUFFJET-MINT-V1',
            costMillimes: 5_000,
            priceMillimes: 10_000,
            taxRateBps: 1_900,
            weightGrams: 50,
            lowStockThreshold: 1,
            publicationStatus: 'PUBLISHED',
          },
        },
      },
      include: { variants: { select: { id: true } } },
    });
    const variant = product.variants[0];
    if (!variant) throw new Error('The operational E2E variant was not created');
    const location = await transaction.inventoryLocation.create({
      data: {
        code: 'E2E-FULFILLMENT',
        name: 'Operational E2E fulfillment',
        active: true,
        fulfillsOrders: true,
      },
    });
    const inventory = await transaction.inventoryItem.create({
      data: {
        variantId: variant.id,
        locationId: location.id,
        onHandQuantity: 4,
      },
    });
    await transaction.stockMovement.create({
      data: {
        inventoryItemId: inventory.id,
        locationId: location.id,
        type: 'INITIAL_STOCK',
        quantityDelta: 4,
        onHandAfter: 4,
        referenceType: 'OPERATIONAL_E2E_FIXTURE',
        referenceId: inventory.id,
        reasonCode: 'DISPOSABLE_TEST_FIXTURE',
        actorUserId: admin.id,
      },
    });

    return {
      productId: product.id,
      variantId: variant.id,
      localityId: locality.id,
      deliveryZoneId: zone.id,
      inventoryItemId: inventory.id,
    };
  });

  console.info(
    JSON.stringify({
      fixture: 'operational-e2e',
      databaseName,
      productSlug: 'puffjet-menthe-operationnelle',
      initialStock: 4,
      ...result,
    }),
  );
} finally {
  await prisma.$disconnect();
}

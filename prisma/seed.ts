import { FeatureFlagEnvironment, PrismaClient, SettingValueType } from '@prisma/client';
import rawGeographySnapshot from './data/tunisia-geography-2024.json';

const prisma = new PrismaClient();

interface GeographySnapshot {
  schemaVersion: number;
  counts: {
    governorates: number;
    delegations: number;
    localities: number;
    bizerteDelegations: number;
    bizerteLocalities: number;
  };
  governorates: Array<{
    code: string;
    officialCode: string;
    nameFr: string;
    nameAr: string;
  }>;
  delegations: Array<{
    code: string;
    governorateCode: string;
    nameFr: string;
    nameAr: string;
  }>;
  localities: Array<{
    code: string;
    delegationCode: string;
    nameFr: string;
    nameAr: string;
  }>;
}

const geographySnapshot: GeographySnapshot = rawGeographySnapshot;
const geographyBatchSize = 40;

const permissions = [
  'products.read',
  'products.create',
  'products.update',
  'products.archive',
  'products.delete',
  'catalog.import',
  'categories.manage',
  'brands.manage',
  'suppliers.manage',
  'inventory.read',
  'inventory.adjust',
  'inventory.approve',
  'inventory.transfer',
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'orders.refund',
  'customers.read',
  'customers.update',
  'customers.suspend',
  'customers.export',
  'deliveries.read',
  'deliveries.assign',
  'deliveries.update',
  'couriers.manage',
  'cash.read',
  'cash.collect',
  'cash.remit',
  'cash.reconcile',
  'promotions.manage',
  'returns.read',
  'returns.manage',
  'reports.read',
  'reports.export',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'compliance.manage',
  'notifications.manage',
  'audit.read',
  'security.read',
  'system.manage',
] as const;

type PermissionKey = (typeof permissions)[number];

const roleDefinitions: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[] | 'all';
}> = [
  {
    key: 'super-administrator',
    name: 'Super Administrator',
    description: 'Unrestricted administrative role; assignment requires elevated approval.',
    permissions: 'all',
  },
  {
    key: 'administrator',
    name: 'Administrator',
    description: 'Day-to-day administration without role, security, or system control.',
    permissions: permissions.filter(
      (key) => !['roles.manage', 'security.read', 'system.manage'].includes(key),
    ),
  },
  {
    key: 'catalog-manager',
    name: 'Catalog Manager',
    description: 'Catalog, taxonomy, brand, supplier, and promotion maintenance.',
    permissions: [
      'products.read',
      'products.create',
      'products.update',
      'products.archive',
      'catalog.import',
      'categories.manage',
      'brands.manage',
      'suppliers.manage',
      'promotions.manage',
    ],
  },
  {
    key: 'inventory-manager',
    name: 'Inventory Manager',
    description: 'Inventory visibility, approved adjustments, and transfers.',
    permissions: [
      'products.read',
      'inventory.read',
      'inventory.adjust',
      'inventory.approve',
      'inventory.transfer',
    ],
  },
  {
    key: 'order-manager',
    name: 'Order Manager',
    description: 'Order processing, cancellation, and return coordination.',
    permissions: [
      'products.read',
      'inventory.read',
      'orders.read',
      'orders.create',
      'orders.update',
      'orders.cancel',
      'orders.refund',
      'customers.read',
      'deliveries.read',
      'returns.read',
      'returns.manage',
    ],
  },
  {
    key: 'customer-support-agent',
    name: 'Customer Support Agent',
    description: 'Customer and order support without price, cash, or role control.',
    permissions: [
      'products.read',
      'orders.read',
      'customers.read',
      'customers.update',
      'deliveries.read',
      'returns.read',
    ],
  },
  {
    key: 'delivery-coordinator',
    name: 'Delivery Coordinator',
    description: 'Courier assignment and authorized delivery state transitions.',
    permissions: [
      'orders.read',
      'customers.read',
      'deliveries.read',
      'deliveries.assign',
      'deliveries.update',
      'couriers.manage',
      'cash.read',
      'reports.export',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'COD collection, remittance, reconciliation, and financial reporting.',
    permissions: [
      'orders.read',
      'cash.read',
      'cash.collect',
      'cash.remit',
      'cash.reconcile',
      'reports.read',
      'reports.export',
    ],
  },
  {
    key: 'read-only-analyst',
    name: 'Read-Only Analyst',
    description: 'Read-only catalog, inventory, order, delivery, and reporting access.',
    permissions: [
      'products.read',
      'inventory.read',
      'orders.read',
      'customers.read',
      'deliveries.read',
      'cash.read',
      'returns.read',
      'reports.read',
    ],
  },
];

const governorates = [
  { code: '11', nameFr: 'Tunis', nameAr: 'تونس' },
  { code: '12', nameFr: 'Ariana', nameAr: 'أريانة' },
  { code: '13', nameFr: 'Ben Arous', nameAr: 'بن عروس' },
  { code: '14', nameFr: 'Manouba', nameAr: 'منوبة' },
  { code: '21', nameFr: 'Nabeul', nameAr: 'نابل' },
  { code: '22', nameFr: 'Zaghouan', nameAr: 'زغوان' },
  { code: '23', nameFr: 'Bizerte', nameAr: 'بنزرت' },
  { code: '31', nameFr: 'Béja', nameAr: 'باجة' },
  { code: '32', nameFr: 'Jendouba', nameAr: 'جندوبة' },
  { code: '33', nameFr: 'Le Kef', nameAr: 'الكاف' },
  { code: '34', nameFr: 'Siliana', nameAr: 'سليانة' },
  { code: '41', nameFr: 'Kairouan', nameAr: 'القيروان' },
  { code: '42', nameFr: 'Kasserine', nameAr: 'القصرين' },
  { code: '43', nameFr: 'Sidi Bouzid', nameAr: 'سيدي بوزيد' },
  { code: '51', nameFr: 'Sousse', nameAr: 'سوسة' },
  { code: '52', nameFr: 'Monastir', nameAr: 'المنستير' },
  { code: '53', nameFr: 'Mahdia', nameAr: 'المهدية' },
  { code: '61', nameFr: 'Sfax', nameAr: 'صفاقس' },
  { code: '71', nameFr: 'Gafsa', nameAr: 'قفصة' },
  { code: '72', nameFr: 'Tozeur', nameAr: 'توزر' },
  { code: '73', nameFr: 'Kébili', nameAr: 'قبلي' },
  { code: '81', nameFr: 'Gabès', nameAr: 'قابس' },
  { code: '82', nameFr: 'Médenine', nameAr: 'مدنين' },
  { code: '83', nameFr: 'Tataouine', nameAr: 'تطاوين' },
] as const;

const storeSettings = [
  {
    key: 'checkout.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Global checkout kill switch. Operational prerequisites still fail closed.',
  },
  {
    key: 'maintenance.mode',
    valueType: SettingValueType.BOOLEAN,
    value: false,
    description: 'Global maintenance mode.',
  },
  {
    key: 'prelaunch.mode',
    valueType: SettingValueType.BOOLEAN,
    value: false,
    description: 'Keeps the public store in pre-launch mode when explicitly enabled.',
  },
  {
    key: 'store.name',
    valueType: SettingValueType.STRING,
    value: '',
    description: 'Legal store name. An empty value blocks production checkout.',
  },
  {
    key: 'store.phone',
    valueType: SettingValueType.STRING,
    value: '',
    description: 'Published Tunisian store phone. An empty value blocks checkout.',
  },
  {
    key: 'store.email',
    valueType: SettingValueType.STRING,
    value: '',
    description: 'Published store email. An empty value blocks checkout.',
  },
  {
    key: 'store.address',
    valueType: SettingValueType.STRING,
    value: '',
    description: 'Published store address. An empty value blocks checkout.',
  },
  {
    key: 'store.currency',
    valueType: SettingValueType.STRING,
    value: 'TND',
    description: 'Store currency. Monetary columns use integer millimes.',
  },
  {
    key: 'store.timezone',
    valueType: SettingValueType.STRING,
    value: 'Africa/Tunis',
    description: 'Presentation timezone; database timestamps remain UTC.',
  },
  {
    key: 'store.default_locale',
    valueType: SettingValueType.STRING,
    value: 'fr',
    description: 'Default public locale.',
  },
  {
    key: 'notifications.admin_order_created.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Queues an internal administrator notification when an order is created.',
  },
  {
    key: 'notifications.customer_order_created.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Queues a customer order-received notification for the configured adapter.',
  },
  {
    key: 'notifications.customer_order_sms.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: false,
    description:
      'Adds SMS to customer order lifecycle notifications. Keep disabled until an SMS provider is configured.',
  },
  {
    key: 'notifications.security_alert_email',
    valueType: SettingValueType.STRING,
    value: '',
    description:
      'Recipient for coalesced security alerts. Empty disables security-alert email without affecting security event recording.',
  },
  {
    key: 'notifications.order_alert_email',
    valueType: SettingValueType.STRING,
    value: '',
    description:
      'Recipient for internal new-order alerts. Empty disables internal email without affecting customer order receipts.',
  },
  {
    key: 'notifications.low_stock_alert_email',
    valueType: SettingValueType.STRING,
    value: '',
    description:
      'Recipient for coalesced low-stock alerts. Empty disables email while dashboard low-stock reporting remains available.',
  },
  {
    key: 'notifications.operational_alert_locale',
    valueType: SettingValueType.STRING,
    value: 'fr',
    description: 'French or Arabic locale for internal security and inventory alert email.',
  },
] as const;

const complianceSettings = [
  {
    key: 'minimum_purchase_age',
    valueType: SettingValueType.INTEGER,
    value: 18,
    description: 'Operator-configured minimum purchase age; the software default is 18.',
  },
  {
    key: 'age_gate.entry.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Shows and enforces the storefront entry age confirmation when enabled.',
  },
  {
    key: 'age_gate.checkout.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Requires an explicit age confirmation during checkout when enabled.',
  },
  {
    key: 'consent.terms.required',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Requires the operator-configured terms confirmation when enabled.',
  },
  {
    key: 'consent.privacy.required',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Requires the operator-configured privacy confirmation when enabled.',
  },
  {
    key: 'consent.recording.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Records enabled customer confirmations and their request evidence.',
  },
  {
    key: 'delivery.age_verification_required',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    description: 'Requires an age-verification result at delivery.',
  },
  {
    key: 'identity_document_images.enabled',
    valueType: SettingValueType.BOOLEAN,
    value: false,
    description: 'National identity document image storage is disabled by default.',
  },
] as const;

const featureFlags = [
  {
    key: 'guest_checkout',
    enabled: false,
    description: 'Guest checkout remains disabled until its operational flow is configured.',
  },
  {
    key: 'manual_delivery_quotes',
    enabled: false,
    description: 'Allow authorized staff to prepare manual quotes for unmatched areas.',
  },
  {
    key: 'partial_cod_collection',
    enabled: false,
    description: 'Partial cash collection is prohibited by default.',
  },
  {
    key: 'customer_two_factor',
    enabled: false,
    description: 'Optional customer 2FA rollout flag; administrator 2FA is mandatory.',
  },
  {
    key: 'courier_api_integrations',
    enabled: false,
    description: 'External courier APIs require explicit provider configuration.',
  },
] as const;

async function seedRbac(): Promise<void> {
  const permissionIds = new Map<string, string>();

  for (const key of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description: `Allows ${key}.` },
      create: { key, description: `Allows ${key}.` },
      select: { id: true },
    });
    permissionIds.set(key, permission.id);
  }

  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: {
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      select: { id: true },
    });

    const assignedPermissions =
      definition.permissions === 'all' ? permissions : definition.permissions;

    for (const permissionKey of assignedPermissions) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Missing seeded permission: ${permissionKey}`);
      }
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId },
        },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}

async function seedGovernorates(): Promise<void> {
  for (const governorate of governorates) {
    await prisma.governorate.upsert({
      where: { code: governorate.code },
      update: { ...governorate, active: true },
      create: { ...governorate, active: true },
    });
  }
}

function normalizedGeographyName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ');
}

function validateGeographySnapshot(): void {
  const expectedCounts = {
    governorates: 24,
    delegations: 279,
    localities: 2_082,
    bizerteDelegations: 14,
    bizerteLocalities: 101,
  } as const;

  if (geographySnapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported Tunisia geography schema: ${geographySnapshot.schemaVersion}.`);
  }

  for (const [key, expected] of Object.entries(expectedCounts)) {
    const declared = geographySnapshot.counts[key as keyof typeof expectedCounts];
    if (declared !== expected) {
      throw new Error(`Unexpected Tunisia geography count for ${key}: ${declared}.`);
    }
  }
  if (
    geographySnapshot.governorates.length !== expectedCounts.governorates ||
    geographySnapshot.delegations.length !== expectedCounts.delegations ||
    geographySnapshot.localities.length !== expectedCounts.localities
  ) {
    throw new Error('Tunisia geography rows do not match their declared counts.');
  }

  const expectedGovernorateCodes = new Set(governorates.map(({ code }) => code));
  const governorateCodes = new Set<string>();
  const officialGovernorateCodes = new Set<string>();
  for (const governorate of geographySnapshot.governorates) {
    if (
      !/^\d{2}$/.test(governorate.code) ||
      !/^\d{2}$/.test(governorate.officialCode) ||
      !governorate.nameFr.trim() ||
      !governorate.nameAr.trim() ||
      governorateCodes.has(governorate.code) ||
      officialGovernorateCodes.has(governorate.officialCode)
    ) {
      throw new Error(`Invalid or duplicate governorate row: ${governorate.code}.`);
    }
    governorateCodes.add(governorate.code);
    officialGovernorateCodes.add(governorate.officialCode);
  }
  if (
    governorateCodes.size !== expectedGovernorateCodes.size ||
    [...expectedGovernorateCodes].some((code) => !governorateCodes.has(code))
  ) {
    throw new Error('Tunisia geography governorate codes do not match the structural seed.');
  }

  const delegationCodes = new Set<string>();
  const delegationNames = new Set<string>();
  for (const delegation of geographySnapshot.delegations) {
    const nameKey = `${delegation.governorateCode}:${normalizedGeographyName(delegation.nameFr)}`;
    if (
      !/^\d{4}$/.test(delegation.code) ||
      !governorateCodes.has(delegation.governorateCode) ||
      !delegation.nameFr.trim() ||
      !delegation.nameAr.trim() ||
      delegationCodes.has(delegation.code) ||
      delegationNames.has(nameKey)
    ) {
      throw new Error(`Invalid or duplicate delegation row: ${delegation.code}.`);
    }
    delegationCodes.add(delegation.code);
    delegationNames.add(nameKey);
  }

  const localityCodes = new Set<string>();
  for (const locality of geographySnapshot.localities) {
    if (
      !/^\d{6}$/.test(locality.code) ||
      !delegationCodes.has(locality.delegationCode) ||
      !locality.nameFr.trim() ||
      !locality.nameAr.trim() ||
      localityCodes.has(locality.code)
    ) {
      throw new Error(`Invalid or duplicate locality row: ${locality.code}.`);
    }
    localityCodes.add(locality.code);
  }

  const requiredBizerteDelegations = new Set(
    Array.from({ length: 14 }, (_, index) => (1_751 + index).toString()),
  );
  const bizerteDelegations = geographySnapshot.delegations.filter(
    ({ governorateCode }) => governorateCode === '23',
  );
  const bizerteDelegationCodes = new Set(bizerteDelegations.map(({ code }) => code));
  const bizerteLocalityCount = geographySnapshot.localities.filter(({ delegationCode }) =>
    bizerteDelegationCodes.has(delegationCode),
  ).length;
  if (
    bizerteDelegations.length !== expectedCounts.bizerteDelegations ||
    [...requiredBizerteDelegations].some((code) => !bizerteDelegationCodes.has(code)) ||
    bizerteLocalityCount !== expectedCounts.bizerteLocalities
  ) {
    throw new Error('The Tunisia geography snapshot has incomplete Bizerte coverage.');
  }
}

async function seedGeography(): Promise<{ delegations: number; localities: number }> {
  validateGeographySnapshot();
  await seedGovernorates();

  const governorateRows = await prisma.governorate.findMany({
    where: { code: { in: geographySnapshot.governorates.map(({ code }) => code) } },
    select: { id: true, code: true },
  });
  const governorateIds = new Map(governorateRows.map(({ code, id }) => [code, id]));
  if (governorateIds.size !== geographySnapshot.governorates.length) {
    throw new Error('A seeded Tunisia governorate could not be reloaded.');
  }

  const delegationIds = new Map<string, string>();
  for (let index = 0; index < geographySnapshot.delegations.length; index += geographyBatchSize) {
    const batch = geographySnapshot.delegations.slice(index, index + geographyBatchSize);
    const results = await prisma.$transaction(
      batch.map((delegation) => {
        const governorateId = governorateIds.get(delegation.governorateCode);
        if (!governorateId) {
          throw new Error(`Missing governorate for delegation ${delegation.code}.`);
        }
        return prisma.delegation.upsert({
          where: { governorateId_code: { governorateId, code: delegation.code } },
          update: { nameFr: delegation.nameFr, nameAr: delegation.nameAr },
          create: {
            governorateId,
            code: delegation.code,
            nameFr: delegation.nameFr,
            nameAr: delegation.nameAr,
            active: true,
          },
          select: { id: true, code: true },
        });
      }),
    );
    for (const delegation of results) {
      delegationIds.set(delegation.code, delegation.id);
    }
  }
  if (delegationIds.size !== geographySnapshot.delegations.length) {
    throw new Error('A seeded Tunisia delegation could not be reloaded.');
  }

  for (let index = 0; index < geographySnapshot.localities.length; index += geographyBatchSize) {
    const batch = geographySnapshot.localities.slice(index, index + geographyBatchSize);
    await prisma.$transaction(
      batch.map((locality) => {
        const delegationId = delegationIds.get(locality.delegationCode);
        if (!delegationId) {
          throw new Error(`Missing delegation for locality ${locality.code}.`);
        }
        return prisma.locality.upsert({
          where: { delegationId_code: { delegationId, code: locality.code } },
          update: { nameFr: locality.nameFr, nameAr: locality.nameAr },
          create: {
            delegationId,
            code: locality.code,
            nameFr: locality.nameFr,
            nameAr: locality.nameAr,
            active: true,
          },
        });
      }),
    );
  }

  return {
    delegations: geographySnapshot.delegations.length,
    localities: geographySnapshot.localities.length,
  };
}

async function seedSettings(): Promise<void> {
  for (const setting of storeSettings) {
    await prisma.storeSetting.upsert({
      where: { key: setting.key },
      update: {
        valueType: setting.valueType,
        description: setting.description,
      },
      create: setting,
    });
  }

  for (const setting of complianceSettings) {
    await prisma.complianceSetting.upsert({
      where: { key: setting.key },
      update: {
        valueType: setting.valueType,
        description: setting.description,
      },
      create: setting,
    });
  }

  for (const flag of featureFlags) {
    await prisma.featureFlag.upsert({
      where: {
        key_environment: {
          key: flag.key,
          environment: FeatureFlagEnvironment.ALL,
        },
      },
      update: { description: flag.description },
      create: {
        ...flag,
        environment: FeatureFlagEnvironment.ALL,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedRbac();
  const geographyCounts = await seedGeography();
  await seedSettings();
  await prisma.sequenceCounter.upsert({
    where: { key: 'order-number' },
    update: {},
    create: { key: 'order-number', value: 0n },
  });

  const [roleCount, permissionCount, governorateCount] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
    prisma.governorate.count(),
  ]);

  console.info(
    `Structural seed complete: ${roleCount} roles, ${permissionCount} permissions, ${governorateCount} governorates, ${geographyCounts.delegations} delegations, and ${geographyCounts.localities} localities. No users, administrators, products, delivery zones, or rates were created.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Structural seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

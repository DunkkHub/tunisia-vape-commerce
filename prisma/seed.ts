import { FeatureFlagEnvironment, PrismaClient, SettingValueType } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  'products.read',
  'products.create',
  'products.update',
  'products.archive',
  'products.delete',
  'categories.manage',
  'brands.manage',
  'suppliers.manage',
  'inventory.read',
  'inventory.adjust',
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
    permissions: ['products.read', 'inventory.read', 'inventory.adjust', 'inventory.transfer'],
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
] as const;

const complianceSettings = [
  {
    key: 'legal_review.completed',
    valueType: SettingValueType.BOOLEAN,
    value: true,
    legallyReviewed: true,
    description: 'Records the externally completed legal review; operational gates still apply.',
  },
  {
    key: 'minimum_purchase_age',
    valueType: SettingValueType.INTEGER,
    value: 18,
    description: 'Approved minimum purchase age; values below 18 block checkout.',
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
    description: 'Guest checkout remains disabled until checkout and legal gates pass.',
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
  await seedGovernorates();
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
    `Structural seed complete: ${roleCount} roles, ${permissionCount} permissions, ${governorateCount} governorates. No users, administrators, or products were created.`,
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

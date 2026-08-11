import { createHash, randomBytes } from 'node:crypto';

const hashToken = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const LOAD_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZsAAAAASUVORK5CYII=',
  'base64',
);

const addApprovedLoadImage = async (transaction, productId, key) => {
  const objectKey = `disposable-load/${productId}/${key.toLowerCase()}.png`;
  await transaction.productImage.create({
    data: {
      productId,
      objectKey,
      objectKeyHash: hashToken(objectKey),
      bucket:
        process.env.MEDIA_STORAGE_DRIVER === 's3'
          ? (process.env.S3_BUCKET ?? 'vape-store')
          : 'local-media',
      contentType: 'image/png',
      originalFilename: `${key.toLowerCase()}.png`,
      byteSize: LOAD_IMAGE_BYTES.length,
      checksumSha256: createHash('sha256').update(LOAD_IMAGE_BYTES).digest('hex'),
      width: 1,
      height: 1,
      altTextFr: `Image de charge ${key}`,
      altTextAr: `Load image ${key}`,
      sortOrder: 0,
      isPrimary: true,
      moderationStatus: 'APPROVED',
    },
  });
};

const sessionLifetime = () => {
  const now = new Date();
  return {
    authenticatedAt: now,
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + 60 * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 4 * 60 * 60_000),
  };
};

const customerPhone = (index) => `+2162${String(1_000_000 + index).padStart(7, '0')}`;

const customerCookie = (sessionToken, csrfToken) =>
  `vape_customer_session=${sessionToken}; vape_customer_csrf=${csrfToken}`;

const adminCookie = (sessionToken, csrfToken) =>
  `vape_admin_session=${sessionToken}; vape_admin_csrf=${csrfToken}`;

const checkoutBody = ({ variantId, localityId, index, email, phone }) => ({
  items: [{ variantId, quantity: 1 }],
  localityId,
  express: false,
  customerName: `Disposable load customer ${index}`,
  phone,
  email,
  address: {
    street: `${index} Load Test Street`,
    postalCode: '1001',
  },
  consent: {
    ageConfirmed: true,
    termsAccepted: true,
    privacyAccepted: true,
  },
});

const productWithInventory = async (
  transaction,
  { brandId, categoryId, locationId, actorUserId, key, flavor, stock },
) => {
  const product = await transaction.product.create({
    data: {
      brandId,
      categoryId,
      nameFr: `Produit charge ${key}`,
      nameAr: `Load product ${key}`,
      slug: `disposable-load-${key}`,
      sku: `LOAD-${key}`,
      productType: 'DISPOSABLE',
      shortDescriptionFr: 'Reference exclusivement reservee au test de charge jetable.',
      shortDescriptionAr: 'Disposable load-test-only product.',
      containsNicotine: true,
      nicotineStrengthMg: 5,
      flavor,
      puffCount: 6_000,
      baseCostMillimes: 5_000,
      basePriceMillimes: 10_000,
      taxRateBps: 1_900,
      warningFr: 'Produit reserve aux adultes.',
      warningAr: 'Adults only.',
      minimumAge: 18,
      publicationStatus: 'PUBLISHED',
      featured: true,
      publishedAt: new Date(Date.now() - 60_000),
      variants: {
        create: {
          nameFr: `Variante ${key}`,
          nameAr: `Variant ${key}`,
          sku: `LOAD-${key}-V1`,
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
  if (!variant) throw new Error(`Fixture product ${key} has no variant`);
  await addApprovedLoadImage(transaction, product.id, key);
  const inventory = await transaction.inventoryItem.create({
    data: {
      variantId: variant.id,
      locationId,
      onHandQuantity: stock,
    },
  });
  await transaction.stockMovement.create({
    data: {
      inventoryItemId: inventory.id,
      locationId,
      type: 'INITIAL_STOCK',
      quantityDelta: stock,
      onHandAfter: stock,
      referenceType: 'DISPOSABLE_LOAD_FIXTURE',
      referenceId: inventory.id,
      reasonCode: 'DISPOSABLE_TEST_FIXTURE',
      actorUserId,
    },
  });
  return { productId: product.id, variantId: variant.id, inventoryItemId: inventory.id };
};

const productWithIndependentInventory = async (
  transaction,
  { brandId, categoryId, locationId, actorUserId, count },
) => {
  const product = await transaction.product.create({
    data: {
      brandId,
      categoryId,
      nameFr: 'Produits charge independants',
      nameAr: 'Independent load products',
      slug: 'disposable-load-independent-checkout',
      sku: 'LOAD-INDEPENDENT-CHECKOUT',
      productType: 'DISPOSABLE',
      shortDescriptionFr: 'Allocations independantes exclusivement reservees au test de charge.',
      shortDescriptionAr: 'Independent allocations used only by the disposable load test.',
      containsNicotine: true,
      nicotineStrengthMg: 5,
      flavor: 'Mint load',
      puffCount: 6_000,
      baseCostMillimes: 5_000,
      basePriceMillimes: 10_000,
      taxRateBps: 1_900,
      warningFr: 'Produit reserve aux adultes.',
      warningAr: 'Adults only.',
      minimumAge: 18,
      publicationStatus: 'PUBLISHED',
      featured: true,
      publishedAt: new Date(Date.now() - 60_000),
      variants: {
        create: Array.from({ length: count }, (_, index) => {
          const serial = String(index + 1).padStart(2, '0');
          return {
            nameFr: `Allocation charge ${serial}`,
            nameAr: `Load allocation ${serial}`,
            sku: `LOAD-CHECKOUT-${serial}`,
            costMillimes: 5_000,
            priceMillimes: 10_000,
            taxRateBps: 1_900,
            weightGrams: 50,
            lowStockThreshold: 1,
            publicationStatus: 'PUBLISHED',
          };
        }),
      },
    },
    include: { variants: { orderBy: { sku: 'asc' }, select: { id: true, sku: true } } },
  });
  const variants = [];
  await addApprovedLoadImage(transaction, product.id, 'INDEPENDENT');
  for (const variant of product.variants) {
    const inventory = await transaction.inventoryItem.create({
      data: { variantId: variant.id, locationId, onHandQuantity: 1 },
    });
    await transaction.stockMovement.create({
      data: {
        inventoryItemId: inventory.id,
        locationId,
        type: 'INITIAL_STOCK',
        quantityDelta: 1,
        onHandAfter: 1,
        referenceType: 'DISPOSABLE_LOAD_FIXTURE',
        referenceId: inventory.id,
        reasonCode: 'DISPOSABLE_TEST_FIXTURE',
        actorUserId,
      },
    });
    variants.push({ variantId: variant.id, inventoryItemId: inventory.id, sku: variant.sku });
  }
  if (variants.length !== count) throw new Error('Independent fixture allocations are incomplete');
  return { productId: product.id, variants };
};

const createCustomerActor = async (prisma, { runId, purpose, index, variantId, localityId }) => {
  const serialOffsets = { checkout: 0, race: 100, repeated: 200, backlog: 300 };
  const serial = (serialOffsets[purpose] ?? 900) + index;
  const email = `load-${purpose}-${index}-${runId}@example.test`;
  const phone = customerPhone(serial);
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const user = await prisma.user.create({
    data: {
      audience: 'CUSTOMER',
      email,
      emailNormalized: email,
      passwordHash: 'disposable-load-fixture-never-used-for-login',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      customerProfile: {
        create: {
          firstName: 'Disposable',
          lastName: `Load ${purpose} ${index}`,
          phoneE164: phone,
          phoneSearch: phone,
          locale: 'fr',
        },
      },
    },
    include: { customerProfile: { select: { id: true } } },
  });
  if (!user.customerProfile) throw new Error('Fixture customer profile was not created');
  await prisma.session.create({
    data: {
      userId: user.id,
      audience: 'CUSTOMER',
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      status: 'ACTIVE',
      ipAddress: '127.0.0.1',
      userAgent: 'disposable-load-orchestrator',
      twoFactorVerified: false,
      ...sessionLifetime(),
    },
  });
  await prisma.cart.create({
    data: {
      customerId: user.customerProfile.id,
      status: 'ACTIVE',
      items: { create: { variantId, quantity: 1 } },
    },
  });
  return {
    userId: user.id,
    purpose,
    headers: {
      Cookie: customerCookie(sessionToken, csrfToken),
      'X-CSRF-Token': csrfToken,
      'Accept-Language': 'fr',
      'X-Client-Context': 'storefront',
    },
    body: checkoutBody({ variantId, localityId, index: serial, email, phone }),
  };
};

export const seedDisposableCommerceFixture = async (prisma, { databaseName, runId }) => {
  if (!/^vape_load_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error('The disposable load fixture requires a generated vape_load_* database');
  }
  const [userCount, productCount, role, tunis] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.role.findUnique({ where: { key: 'read-only-analyst' }, select: { id: true } }),
    prisma.governorate.findUnique({ where: { code: '11' }, select: { id: true } }),
  ]);
  if (userCount !== 0 || productCount !== 0) {
    throw new Error('The disposable load fixture requires a clean structural seed');
  }
  if (!role || !tunis) throw new Error('Run the structural seed before the load fixture');

  const foundation = await prisma.$transaction(
    async (transaction) => {
      await Promise.all([
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
          data: { value: 'Disposable Load Store' },
        }),
        transaction.storeSetting.update({
          where: { key: 'store.phone' },
          data: { value: '+21670000000' },
        }),
        transaction.storeSetting.update({
          where: { key: 'store.email' },
          data: { value: 'load-operations@example.test' },
        }),
        transaction.storeSetting.update({
          where: { key: 'store.address' },
          data: { value: 'Disposable load facility, Tunis' },
        }),
        transaction.complianceSetting.update({
          where: { key: 'minimum_purchase_age' },
          data: { value: 18 },
        }),
        transaction.complianceSetting.update({
          where: { key: 'age_gate.entry.enabled' },
          data: { value: false },
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

      const adminSessionToken = randomBytes(32).toString('base64url');
      const adminCsrfToken = randomBytes(32).toString('base64url');
      const adminEmail = `load-admin-${runId}@example.test`;
      const admin = await transaction.user.create({
        data: {
          audience: 'ADMIN',
          email: adminEmail,
          emailNormalized: adminEmail,
          passwordHash: 'disposable-load-fixture-never-used-for-login',
          status: 'ACTIVE',
          adminProfile: {
            create: {
              displayName: 'Disposable Load Analyst',
              employeeCode: `LOAD-${runId}`.slice(0, 50),
              jobTitle: 'Disposable test operator',
              mustEnrollTwoFactor: false,
              twoFactorEnforcedAt: new Date(),
              invitationAcceptedAt: new Date(),
            },
          },
          twoFactorSecret: {
            create: {
              encryptedSecret: 'disposable-load-secret-never-decrypted',
              encryptionKeyId: 'disposable-load-only',
              verifiedAt: new Date(),
            },
          },
          roles: { create: { roleId: role.id } },
        },
      });
      await transaction.session.create({
        data: {
          userId: admin.id,
          audience: 'ADMIN',
          tokenHash: hashToken(adminSessionToken),
          csrfTokenHash: hashToken(adminCsrfToken),
          status: 'ACTIVE',
          ipAddress: '127.0.0.1',
          userAgent: 'disposable-load-orchestrator',
          twoFactorVerified: true,
          ...sessionLifetime(),
        },
      });

      const delegation = await transaction.delegation.create({
        data: {
          governorateId: tunis.id,
          code: 'LOAD-TUNIS',
          nameFr: 'Delegation charge jetable',
          nameAr: 'Disposable load delegation',
          active: true,
        },
      });
      const locality = await transaction.locality.create({
        data: {
          delegationId: delegation.id,
          code: 'LOAD-LOCALITY',
          nameFr: 'Localite charge jetable',
          nameAr: 'Disposable load locality',
          active: true,
        },
      });
      await transaction.postalCode.create({
        data: { localityId: locality.id, code: '1001', active: true },
      });
      const zone = await transaction.deliveryZone.create({
        data: {
          code: 'LOAD-COURIER',
          nameFr: 'Livraison charge jetable',
          nameAr: 'Disposable load delivery',
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
              name: 'Disposable load base rate',
              priority: 100,
              feeMillimes: 7_000,
              active: true,
            },
          },
        },
      });
      const category = await transaction.category.create({
        data: {
          nameFr: 'Jetables charge',
          nameAr: 'Disposable load category',
          slug: 'jetables-charge',
          publicationStatus: 'PUBLISHED',
        },
      });
      const brand = await transaction.brand.create({
        data: {
          name: 'PuffJet Load',
          slug: 'puffjet-load',
          publicationStatus: 'PUBLISHED',
        },
      });
      const location = await transaction.inventoryLocation.create({
        data: {
          code: 'LOAD-FULFILLMENT',
          name: 'Disposable load fulfillment',
          active: true,
          fulfillsOrders: true,
        },
      });

      const checkout = await productWithIndependentInventory(transaction, {
        brandId: brand.id,
        categoryId: category.id,
        locationId: location.id,
        actorUserId: admin.id,
        count: 60,
      });
      const race = await productWithInventory(transaction, {
        brandId: brand.id,
        categoryId: category.id,
        locationId: location.id,
        actorUserId: admin.id,
        key: 'FINAL-UNIT',
        flavor: 'Berry race',
        stock: 1,
      });
      const repeated = await productWithInventory(transaction, {
        brandId: brand.id,
        categoryId: category.id,
        locationId: location.id,
        actorUserId: admin.id,
        key: 'IDEMPOTENCY',
        flavor: 'Grape replay',
        stock: 1,
      });

      return {
        adminUserId: admin.id,
        adminHeaders: {
          Cookie: adminCookie(adminSessionToken, adminCsrfToken),
          'X-CSRF-Token': adminCsrfToken,
          'Accept-Language': 'fr',
          'X-Client-Context': 'admin',
        },
        localityId: locality.id,
        deliveryZoneId: zone.id,
        checkout,
        race,
        repeated,
      };
    },
    { timeout: 60_000 },
  );

  const checkoutActors = [];
  for (let index = 1; index <= 50; index += 1) {
    const allocation = foundation.checkout.variants[index - 1];
    if (!allocation) throw new Error('A checkout load allocation is missing');
    checkoutActors.push(
      await createCustomerActor(prisma, {
        runId,
        purpose: 'checkout',
        index,
        variantId: allocation.variantId,
        localityId: foundation.localityId,
      }),
    );
  }
  const raceActors = [];
  for (let index = 1; index <= 2; index += 1) {
    raceActors.push(
      await createCustomerActor(prisma, {
        runId,
        purpose: 'race',
        index,
        variantId: foundation.race.variantId,
        localityId: foundation.localityId,
      }),
    );
  }
  const repeatedActor = await createCustomerActor(prisma, {
    runId,
    purpose: 'repeated',
    index: 1,
    variantId: foundation.repeated.variantId,
    localityId: foundation.localityId,
  });
  const backlogActors = [];
  for (let index = 1; index <= 10; index += 1) {
    const allocation = foundation.checkout.variants[49 + index];
    if (!allocation) throw new Error('A backlog load allocation is missing');
    backlogActors.push(
      await createCustomerActor(prisma, {
        runId,
        purpose: 'backlog',
        index,
        variantId: allocation.variantId,
        localityId: foundation.localityId,
      }),
    );
  }

  return {
    ...foundation,
    checkoutActors,
    raceActors,
    repeatedActor,
    backlogActors,
    expected: {
      orders: 62,
      activeReservations: 62,
      checkoutRemaining: 0,
      raceRemaining: 0,
      repeatedRemaining: 0,
      notifications: 62,
    },
  };
};

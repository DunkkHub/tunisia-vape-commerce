import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the operational E2E suite`);
  return value;
};

const apiUrl = required('OPERATIONAL_E2E_API_URL');
const webUrl = required('PLAYWRIGHT_BASE_URL');
const adminEmail = required('OPERATIONAL_E2E_ADMIN_EMAIL');
const adminPassword = required('OPERATIONAL_E2E_ADMIN_PASSWORD');
const reconcilerEmail = required('OPERATIONAL_E2E_RECONCILER_EMAIL');
const reconcilerPassword = required('OPERATIONAL_E2E_RECONCILER_PASSWORD');
const limitedAdminEmail = required('OPERATIONAL_E2E_LIMITED_ADMIN_EMAIL');
const limitedAdminPassword = required('OPERATIONAL_E2E_LIMITED_ADMIN_PASSWORD');
const customerEmail = required('OPERATIONAL_E2E_CUSTOMER_EMAIL');
const customerPassword = required('OPERATIONAL_E2E_CUSTOMER_PASSWORD');
const customerPhone = required('OPERATIONAL_E2E_CUSTOMER_PHONE');
const mediaFixturePaths = (() => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required('OPERATIONAL_E2E_MEDIA_PATHS'));
  } catch {
    throw new Error('OPERATIONAL_E2E_MEDIA_PATHS must contain a JSON array');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    parsed.some((value) => typeof value !== 'string' || value.trim().length === 0)
  ) {
    throw new Error('OPERATIONAL_E2E_MEDIA_PATHS must identify exactly four image fixtures');
  }
  return parsed as [string, string, string, string];
})();

interface PageResult<T> {
  items: T[];
  total: number;
}

interface CheckoutResult {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotalMillimes: number;
  deliveryTotalMillimes: number;
  taxTotalMillimes: number;
  grandTotalMillimes: number;
  expectedCodMillimes: number;
  fulfillment: {
    type: 'COURIER' | 'STORE_PICKUP';
    estimatedMinDays: number | null;
    estimatedMaxDays: number | null;
    estimatedMinMinutes: number | null;
    estimatedMaxMinutes: number | null;
    paymentMethod: 'CASH_ON_DELIVERY' | null;
    phoneConfirmationRequired: boolean;
  };
}

interface AdminDelivery {
  id: string;
  status: string;
  version: number;
  ageVerificationRequired: boolean;
}

interface AdminOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  version: number;
  delivery: AdminDelivery;
}

interface SettingRecord {
  scope: 'STORE' | 'COMPLIANCE';
  key: string;
  value: unknown;
  version: number;
}

interface CashCollection {
  id: string;
  orderNumber: string;
  orderVersion: number;
  status: string;
  expectedMillimes: number;
  collectedMillimes: number;
  delivery: { id: string; version: number; status: string };
}

interface AdminProductSummary {
  id: string;
  slug: string;
  version: number;
}

interface AdminVariantSummary {
  id: string;
  sku: string;
  version: number;
}

interface AdminManagedVariant extends AdminVariantSummary {
  nameFr: string;
  nameAr: string;
  color: string | null;
  priceMillimes: number;
  publicationStatus: string;
}

interface AdminManagedProduct {
  id: string;
  version: number;
  nameFr: string;
  flavor: string | null;
  featured: boolean;
  publicationStatus: string;
}

interface AdminDeliveryZoneConfig {
  id: string;
  code: string;
  nameFr: string;
  active: boolean;
  supported: boolean;
  phoneConfirmationRequired: boolean;
  manualReviewRequired: boolean;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  estimatedMinMinutes: number | null;
  estimatedMaxMinutes: number | null;
  paymentMethod: 'CASH_ON_DELIVERY' | null;
  assignmentMode: 'MANUAL' | null;
  driverCommunication: 'WHATSAPP' | 'PHONE' | null;
  localityCount: number;
  activeRateCount: number;
  updatedAt: string;
}

interface AdminDeliveryRateConfig {
  id: string;
  name: string;
  feeMillimes: number;
  active: boolean;
  version: number;
}

interface GeographyOption {
  id: string;
  name: string;
  supported: boolean;
}

interface DeliveryMethod {
  id: string;
  type: 'COURIER' | 'STORE_PICKUP';
  label: string;
  estimatedMinMinutes: number | null;
  estimatedMaxMinutes: number | null;
  paymentMethod: 'CASH_ON_DELIVERY' | null;
  phoneConfirmationRequired: boolean;
}

interface AdminProductImage {
  id: string;
  productId: string | null;
  variantId: string | null;
  url: string;
  altTextFr: string;
  altTextAr: string;
  sortOrder: number;
  isPrimary: boolean;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  ownerVersion: number;
}

interface PublicProductDetail {
  id: string;
  slug: string;
  primaryImage: { url: string; altText: string } | null;
  images: Array<{ url: string; altText: string }>;
}

interface CatalogImportBatch {
  id: string;
  importKey: string;
  dryRun: boolean;
  status: string;
  appliedCount: number;
  rows?: Array<{
    stableIdentity: string;
    status: string;
    productId: string | null;
    variantId: string | null;
  }>;
}

const expectLoadedImage = async (image: Locator) => {
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect
    .poll(
      () =>
        image.evaluate((element: HTMLImageElement) => ({
          complete: element.complete,
          width: element.naturalWidth,
          height: element.naturalHeight,
        })),
      { timeout: 10_000 },
    )
    .toEqual({ complete: true, width: 320, height: 320 });
};

const confirmAge = async (page: Page) => {
  const confirm = page.getByRole('button', { name: /Je confirme avoir 18 ans ou plus/i });
  const visible = await confirm
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (visible) {
    const response = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/compliance/age-gate' &&
        candidate.request().method() === 'POST',
    );
    await confirm.click();
    expect((await response).status()).toBe(204);
    await expect(confirm).toBeHidden();
  }
};

const decodeBase32 = (value: string): Buffer => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The enrollment secret is not valid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

const currentTotp = (secret: string): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary =
    ((digest[offset] ?? 0) & 0x7f) * 0x1000000 +
    (digest[offset + 1] ?? 0) * 0x10000 +
    (digest[offset + 2] ?? 0) * 0x100 +
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
};

const adminCsrf = async (context: BrowserContext): Promise<string> => {
  const csrf = (await context.cookies(apiUrl)).find((cookie) =>
    ['__Host-vape_admin_csrf', 'vape_admin_csrf'].includes(cookie.name),
  );
  if (!csrf) throw new Error('The administrator CSRF cookie was not issued');
  return decodeURIComponent(csrf.value);
};

const adminRaw = async (
  context: BrowserContext,
  method: string,
  path: string,
  data?: unknown,
  extraHeaders: Record<string, string> = {},
) => {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  return context.request.fetch(`${apiUrl}/api/v1${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'fr',
      'X-Client-Context': 'admin',
      ...(mutation
        ? {
            Origin: webUrl,
            'X-CSRF-Token': await adminCsrf(context),
          }
        : {}),
      ...extraHeaders,
    },
  });
};

const adminApi = async <T>(
  context: BrowserContext,
  method: string,
  path: string,
  data?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> => {
  const response = await adminRaw(context, method, path, data, extraHeaders);
  const text = await response.text();
  expect([200, 201], `${method} ${path} returned ${response.status()}: ${text}`).toContain(
    response.status(),
  );
  const payload = JSON.parse(text) as { data: T };
  return payload.data;
};

const loginAdmin = async (page: Page, email: string, password: string) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: /administration$/ })).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const passwordResponse = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === '/api/v1/auth/admin/login' &&
      candidate.request().method() === 'POST',
  );
  await page.locator('.admin-login__card form button[type="submit"]').click();
  expect((await passwordResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: /activation 2FA$/ })).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Code QR de configuration de l.authentification/ }),
  ).toBeVisible();
  const enrollmentSecret = (await page.locator('.enrollment-key').textContent())?.trim();
  expect(enrollmentSecret).toMatch(/^[A-Z2-7]+$/);
  await page.locator('input[name="code"]').fill(currentTotp(enrollmentSecret!));
  const totpResponse = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === '/api/v1/auth/admin/totp' &&
      candidate.request().method() === 'POST',
  );
  await page.locator('.admin-login__card form button[type="submit"]').click();
  expect((await totpResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: /Vue op/ })).toBeVisible();
};

test('real services cover storefront, order-to-cash, technical gates, TOTP, and RBAC', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  let checkout!: CheckoutResult;
  let remittanceId = '';
  let managedProductId = '';
  let managedVariantId = '';
  let supportedBizerteLocalityId = '';
  let unsupportedBizerteLocalityId = '';

  await test.step('super-administrator completes password and TOTP authentication', async () => {
    await loginAdmin(page, adminEmail, adminPassword);
    const [customerSession, adminSession] = await Promise.all([
      context.request.get(`${apiUrl}/api/v1/auth/customer/session`, {
        headers: { 'X-Client-Context': 'customer' },
      }),
      context.request.get(`${apiUrl}/api/v1/auth/admin/session`, {
        headers: { 'X-Client-Context': 'admin' },
      }),
    ]);
    expect(customerSession.status()).toBe(401);
    expect(adminSession.status()).toBe(200);
  });

  await test.step('Bizerte Express configuration persists atomically from 4 to 8000 millimes', async () => {
    let zones = await adminApi<PageResult<AdminDeliveryZoneConfig>>(
      context,
      'GET',
      '/admin/delivery-config/zones?page=1&limit=50',
    );
    let zone = zones.items.find(({ code }) => code === 'BIZERTE_EXPRESS');
    expect(zone).toMatchObject({
      active: false,
      supported: false,
      localityCount: 0,
      activeRateCount: 0,
      estimatedMinMinutes: null,
      estimatedMaxMinutes: null,
    });
    if (!zone) throw new Error('The disposable Bizerte Express zone is missing');
    const deliveryZoneId = zone.id;
    const rates = await adminApi<PageResult<AdminDeliveryRateConfig>>(
      context,
      'GET',
      '/admin/delivery-config/rates?page=1&limit=50',
    );
    let rate = rates.items.find(({ name }) => name === 'Bizerte Express E2E base rate');
    expect(rate).toMatchObject({ feeMillimes: 4, active: false, version: 1 });
    if (!rate) throw new Error('The disposable Bizerte Express rate is missing');
    const deliveryRateId = rate.id;

    const rejectedActivation = await adminRaw(
      context,
      'POST',
      `/admin/delivery-config/zones/${deliveryZoneId}/activate`,
      { expectedUpdatedAt: zone.updatedAt, confirmed: true },
    );
    expect(rejectedActivation.status()).toBe(409);
    expect((await rejectedActivation.json()) as { code?: string }).toMatchObject({
      code: 'BIZERTE_EXPRESS_CONFIGURATION_INVALID',
    });
    zone = await adminApi<AdminDeliveryZoneConfig>(
      context,
      'GET',
      `/admin/delivery-config/zones/${deliveryZoneId}`,
    );
    expect(zone).toMatchObject({ active: false, supported: false, localityCount: 0 });

    await page.goto('/admin/delivery');
    await expect(page.getByRole('heading', { name: /livraisons/i }).first()).toBeVisible();
    let zonePanel = page
      .locator('article.admin-delivery-zone-card')
      .filter({ hasText: 'BIZERTE_EXPRESS' });
    await zonePanel.getByText('Modifier les réglages de la zone').click();
    const zoneEditor = zonePanel.locator('form[aria-label*="BIZERTE_EXPRESS"]');
    await zoneEditor.getByRole('button', { name: /Appliquer Bizerte Express/ }).click();
    await expect(zoneEditor.locator('input[name="estimatedMinMinutes"]')).toHaveValue('30');
    await expect(zoneEditor.locator('input[name="estimatedMaxMinutes"]')).toHaveValue('50');
    await expect(zoneEditor.locator('select[name="paymentMethod"]')).toHaveValue(
      'CASH_ON_DELIVERY',
    );
    await expect(zoneEditor.locator('select[name="assignmentMode"]')).toHaveValue('MANUAL');
    await expect(zoneEditor.locator('select[name="driverCommunication"]')).toHaveValue('WHATSAPP');
    const zoneUpdateResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/zones/${deliveryZoneId}` &&
        candidate.request().method() === 'PATCH',
    );
    await zoneEditor.getByRole('button', { name: 'Enregistrer la zone' }).click();
    expect((await zoneUpdateResponse).status()).toBe(200);

    let ratePanel = page
      .locator('article.admin-delivery-record')
      .filter({ hasText: 'Bizerte Express E2E base rate' });
    const rateAmount = ratePanel.locator('input[name^="rate-"][name$="-amountTnd"]');
    await expect(rateAmount).toHaveValue('0,004');
    await rateAmount.fill('8,000');
    const rateUpdateResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/rates/${deliveryRateId}` &&
        candidate.request().method() === 'PATCH',
    );
    await ratePanel.getByRole('button', { name: 'Enregistrer le montant' }).click();
    expect((await rateUpdateResponse).status()).toBe(200);

    await page.reload();
    ratePanel = page
      .locator('article.admin-delivery-record')
      .filter({ hasText: 'Bizerte Express E2E base rate' });
    await expect(ratePanel.locator('input[name^="rate-"][name$="-amountTnd"]')).toHaveValue(
      '8,000',
    );
    rate = await adminApi<AdminDeliveryRateConfig>(
      context,
      'GET',
      `/admin/delivery-config/rates/${deliveryRateId}`,
    );
    expect(rate).toMatchObject({ feeMillimes: 8_000, active: false, version: 2 });

    zone = await adminApi<AdminDeliveryZoneConfig>(
      context,
      'GET',
      `/admin/delivery-config/zones/${deliveryZoneId}`,
    );
    const rejectedIncompleteActivation = await adminRaw(
      context,
      'POST',
      `/admin/delivery-config/zones/${deliveryZoneId}/activate`,
      { expectedUpdatedAt: zone.updatedAt, confirmed: true },
    );
    expect(rejectedIncompleteActivation.status()).toBe(409);
    expect((await rejectedIncompleteActivation.json()) as { code?: string }).toMatchObject({
      code: 'DELIVERY_ZONE_GEOGRAPHY_MISSING',
    });
    zone = await adminApi<AdminDeliveryZoneConfig>(
      context,
      'GET',
      `/admin/delivery-config/zones/${deliveryZoneId}`,
    );
    rate = await adminApi<AdminDeliveryRateConfig>(
      context,
      'GET',
      `/admin/delivery-config/rates/${deliveryRateId}`,
    );
    expect(zone).toMatchObject({ active: false, supported: false, localityCount: 0 });
    expect(rate).toMatchObject({ feeMillimes: 8_000, active: false, version: 2 });

    const governorates = await adminApi<GeographyOption[]>(
      context,
      'GET',
      '/admin/delivery-config/geography/governorates',
    );
    const bizerte = governorates.find(({ name }) => name === 'Bizerte');
    const tunis = governorates.find(({ name }) => name === 'Tunis');
    expect(bizerte).toBeTruthy();
    expect(tunis).toBeTruthy();
    const [bizerteDelegations, tunisDelegations] = await Promise.all([
      adminApi<GeographyOption[]>(
        context,
        'GET',
        `/admin/delivery-config/geography/governorates/${bizerte!.id}/delegations`,
      ),
      adminApi<GeographyOption[]>(
        context,
        'GET',
        `/admin/delivery-config/geography/governorates/${tunis!.id}/delegations`,
      ),
    ]);
    const bizerteNorth = bizerteDelegations.find(({ name }) => name === 'Bizerte Nord');
    const tunisDelegation = tunisDelegations[0];
    expect(bizerteNorth).toBeTruthy();
    expect(tunisDelegation).toBeTruthy();
    const [bizerteLocalities, tunisLocalities] = await Promise.all([
      adminApi<GeographyOption[]>(
        context,
        'GET',
        `/admin/delivery-config/geography/delegations/${bizerteNorth!.id}/localities`,
      ),
      adminApi<GeographyOption[]>(
        context,
        'GET',
        `/admin/delivery-config/geography/delegations/${tunisDelegation!.id}/localities`,
      ),
    ]);
    const supportedBizerteLocality = bizerteLocalities.find(({ name }) => name === 'La medina');
    const unsupportedBizerteLocality = bizerteLocalities.find(({ name }) => name === 'El corniche');
    expect(supportedBizerteLocality).toBeTruthy();
    expect(unsupportedBizerteLocality).toBeTruthy();
    expect(tunisLocalities[0]).toBeTruthy();
    supportedBizerteLocalityId = supportedBizerteLocality!.id;
    unsupportedBizerteLocalityId = unsupportedBizerteLocality!.id;

    zone = await adminApi<AdminDeliveryZoneConfig>(
      context,
      'GET',
      `/admin/delivery-config/zones/${deliveryZoneId}`,
    );
    const rejectedCoverage = await adminRaw(
      context,
      'PUT',
      `/admin/delivery-config/zones/${deliveryZoneId}/geography-links`,
      {
        expectedUpdatedAt: zone.updatedAt,
        confirmed: true,
        scope: 'LOCALITY',
        geographyId: tunisLocalities[0]!.id,
        active: true,
      },
    );
    expect(rejectedCoverage.status()).toBe(409);
    expect((await rejectedCoverage.json()) as { code?: string }).toMatchObject({
      code: 'BIZERTE_EXPRESS_COVERAGE_INVALID',
    });
    zone = await adminApi<AdminDeliveryZoneConfig>(
      context,
      'GET',
      `/admin/delivery-config/zones/${deliveryZoneId}`,
    );
    expect(zone).toMatchObject({ active: false, supported: false, localityCount: 0 });

    const geographyForm = page.locator('form').filter({
      has: page.locator('select[name="zoneId"]'),
    });
    await geographyForm.locator('select[name="zoneId"]').selectOption(deliveryZoneId);
    await geographyForm.locator('select[name="scope"]').selectOption('LOCALITY');
    const delegationsResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/geography/governorates/${bizerte!.id}/delegations` &&
        candidate.request().method() === 'GET',
    );
    await geographyForm.locator('select[name="governorateId"]').selectOption(bizerte!.id);
    expect((await delegationsResponse).status()).toBe(200);
    const localitiesResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/geography/delegations/${bizerteNorth!.id}/localities` &&
        candidate.request().method() === 'GET',
    );
    await geographyForm.locator('select[name="delegationId"]').selectOption(bizerteNorth!.id);
    expect((await localitiesResponse).status()).toBe(200);
    await geographyForm
      .locator('select[name="localityId"]')
      .selectOption(supportedBizerteLocalityId);
    const linkResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/zones/${deliveryZoneId}/geography-links` &&
        candidate.request().method() === 'PUT',
    );
    await geographyForm.getByRole('button', { name: 'Ajouter cette couverture' }).click();
    expect((await linkResponse).status()).toBe(200);
    await page.reload();

    ratePanel = page
      .locator('article.admin-delivery-record')
      .filter({ hasText: 'Bizerte Express E2E base rate' });
    zonePanel = page
      .locator('article.admin-delivery-zone-card')
      .filter({ hasText: 'BIZERTE_EXPRESS' });
    await expect(
      zonePanel.getByRole('button', { name: 'Activer la zone BIZERTE_EXPRESS' }),
    ).toBeDisabled();
    const rateActivation = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/rates/${deliveryRateId}/activate` &&
        candidate.request().method() === 'POST',
    );
    await ratePanel
      .getByRole('button', { name: 'Activer le tarif Bizerte Express E2E base rate' })
      .click();
    expect((await rateActivation).status()).toBe(200);

    await expect(
      zonePanel.getByRole('button', { name: 'Activer la zone BIZERTE_EXPRESS' }),
    ).toBeEnabled();
    const zoneActivation = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/delivery-config/zones/${deliveryZoneId}/activate` &&
        candidate.request().method() === 'POST',
    );
    await zonePanel.getByRole('button', { name: 'Activer la zone BIZERTE_EXPRESS' }).click();
    expect((await zoneActivation).status()).toBe(200);

    await page.reload();
    zones = await adminApi<PageResult<AdminDeliveryZoneConfig>>(
      context,
      'GET',
      '/admin/delivery-config/zones?page=1&limit=50',
    );
    zone = zones.items.find(({ code }) => code === 'BIZERTE_EXPRESS');
    expect(zone).toMatchObject({
      active: true,
      supported: true,
      localityCount: 1,
      activeRateCount: 1,
      estimatedMinDays: null,
      estimatedMaxDays: null,
      estimatedMinMinutes: 30,
      estimatedMaxMinutes: 50,
      paymentMethod: 'CASH_ON_DELIVERY',
      assignmentMode: 'MANUAL',
      driverCommunication: 'WHATSAPP',
      phoneConfirmationRequired: false,
    });
  });

  await test.step('administrator creates the sellable product, media, variant, stock, and publication', async () => {
    const [categories, brands] = await Promise.all([
      adminApi<PageResult<{ id: string }>>(
        context,
        'GET',
        '/admin/categories?page=1&limit=50&sort=name_asc',
      ),
      adminApi<PageResult<{ id: string }>>(
        context,
        'GET',
        '/admin/brands?page=1&limit=50&sort=name_asc',
      ),
    ]);
    const categoryId = categories.items[0]?.id;
    const brandId = brands.items[0]?.id;
    expect(categoryId).toBeTruthy();
    expect(brandId).toBeTruthy();
    await page.goto('/admin/catalog/new');
    await expect(page.getByRole('heading', { name: 'Fiche produit' })).toBeVisible();
    const createProductForm = page.locator('.admin-editor > form');
    await expect(
      createProductForm.locator(`select[name="categoryId"] option[value="${categoryId}"]`),
    ).toHaveCount(1);
    await expect(
      createProductForm.locator(`select[name="brandId"] option[value="${brandId}"]`),
    ).toHaveCount(1);
    await createProductForm.locator('input[name="nameFr"]').fill('Produit E2E administré');
    await createProductForm.locator('input[name="nameAr"]').fill('منتج إدارة E2E');
    await createProductForm.locator('input[name="slug"]').fill('admin-created-e2e-product');
    await createProductForm.locator('select[name="productType"]').selectOption('DISPOSABLE');
    await createProductForm.locator('input[name="flavor"]').fill('Agrumes E2E');
    await createProductForm.locator('select[name="categoryId"]').selectOption(categoryId!);
    await createProductForm.locator('select[name="brandId"]').selectOption(brandId!);
    await createProductForm.locator('input[name="sku"]').fill('E2E-ADMIN-PRODUCT');
    await createProductForm.locator('input[name="basePriceMillimes"]').fill('13000');
    await createProductForm
      .locator('input[name="shortDescriptionFr"]')
      .fill('Créé par le workflow Playwright réel.');
    await createProductForm
      .locator('input[name="shortDescriptionAr"]')
      .fill('تم إنشاؤه من خلال اختبار Playwright الحقيقي.');
    await createProductForm
      .locator('textarea[name="descriptionFr"]')
      .fill('Produit créé, modifié et publié depuis la véritable interface administrateur.');
    await createProductForm
      .locator('textarea[name="descriptionAr"]')
      .fill('تم إنشاء المنتج وتعديله ونشره من واجهة الإدارة الحقيقية.');
    await createProductForm.locator('input[name="warningFr"]').fill('Réservé aux adultes.');
    await createProductForm.locator('input[name="warningAr"]').fill('مخصص للبالغين.');
    await createProductForm.locator('input[name="minimumAge"]').fill('18');
    await createProductForm.locator('input[name="containsNicotine"]').check();
    const productCreateResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/admin/products' &&
        candidate.request().method() === 'POST',
    );
    await createProductForm.getByRole('button', { name: 'Enregistrer le produit' }).click();
    const createdHttp = await productCreateResponse;
    expect(createdHttp.status()).toBe(201);
    const created = ((await createdHttp.json()) as { data: AdminManagedProduct }).data;
    managedProductId = created.id;
    expect(created).toMatchObject({
      nameFr: 'Produit E2E administré',
      flavor: 'Agrumes E2E',
      publicationStatus: 'DRAFT',
      featured: false,
    });
    await expect(page).toHaveURL(/\/admin\/catalog$/);

    await page.goto(`/admin/catalog/${managedProductId}/edit`);
    const updateProductForm = page.locator('.admin-editor > form');
    await expect(updateProductForm.locator('input[name="nameFr"]')).toHaveValue(
      'Produit E2E administré',
    );
    await updateProductForm.locator('input[name="nameFr"]').fill('Produit E2E administré modifié');
    await updateProductForm.locator('input[name="flavor"]').fill('Citron E2E');
    const productUpdateResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `/api/v1/admin/products/${managedProductId}` &&
        candidate.request().method() === 'PATCH',
    );
    await updateProductForm.getByRole('button', { name: 'Enregistrer le produit' }).click();
    const updatedHttp = await productUpdateResponse;
    expect(updatedHttp.status()).toBe(200);
    const updated = ((await updatedHttp.json()) as { data: AdminManagedProduct }).data;
    expect(updated.id).toBe(managedProductId);
    expect(updated).toMatchObject({
      nameFr: 'Produit E2E administré modifié',
      flavor: 'Citron E2E',
      publicationStatus: 'DRAFT',
    });
    await expect(page).toHaveURL(/\/admin\/catalog$/);

    await page.goto(`/admin/catalog/${managedProductId}/edit`);
    await page.getByRole('heading', { name: 'Variantes, prix et seuils', exact: true }).click();
    const createVariantForm = page
      .locator('form.admin-panel')
      .filter({ hasText: 'Nouvelle variante (brouillon)' });
    await expect(createVariantForm).toBeVisible();
    await createVariantForm.locator('input[name="nameFr"]').fill('Citron électrique E2E');
    await createVariantForm.locator('input[name="nameAr"]').fill('ليمون كهربائي E2E');
    await createVariantForm.locator('input[name="sku"]').fill('E2E-ADMIN-CITRON-V1');
    await createVariantForm.locator('input[name="color"]').fill('Jaune');
    await createVariantForm.locator('input[name="costMillimes"]').fill('6000');
    await createVariantForm.locator('input[name="priceMillimes"]').fill('13000');
    await createVariantForm.locator('input[name="lowStockThreshold"]').fill('1');
    const variantCreateResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/products/${managedProductId}/variants` &&
        candidate.request().method() === 'POST',
    );
    await createVariantForm.getByRole('button', { name: 'Créer la variante' }).click();
    const variantHttp = await variantCreateResponse;
    expect(variantHttp.status()).toBe(201);
    const variant = ((await variantHttp.json()) as { data: AdminManagedVariant }).data;
    managedVariantId = variant.id;
    expect(managedVariantId).toBeTruthy();
    expect(variant).toMatchObject({
      nameFr: 'Citron électrique E2E',
      sku: 'E2E-ADMIN-CITRON-V1',
      color: 'Jaune',
      priceMillimes: 13_000,
      publicationStatus: 'DRAFT',
    });
    expect(Number.isSafeInteger(variant.priceMillimes) && variant.priceMillimes > 0).toBe(true);

    let variantForm = page.locator('form.admin-panel').filter({ hasText: 'E2E-ADMIN-CITRON-V1' });
    await expect(variantForm).toBeVisible();
    await page.getByRole('heading', { name: 'Images du produit', exact: true }).click();
    const uploadForm = page.locator('.admin-media-upload');
    await expect(uploadForm).toBeVisible();
    const mediaListPath = `/api/v1/admin/products/${managedProductId}/images`;
    const imageCard = (altText: string) =>
      page.locator('.admin-media-card').filter({
        has: page.getByRole('img', { name: altText, exact: true }),
      });
    const waitForMediaRefresh = () =>
      page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === mediaListPath &&
          candidate.request().method() === 'GET' &&
          candidate.status() === 200,
      );
    const uploadManagedImage = async (
      fixturePath: string,
      altTextFr: string,
      altTextAr: string,
      isPrimary: boolean,
    ) => {
      await uploadForm.locator('input[name="file"]').setInputFiles(fixturePath);
      await uploadForm.locator('select[name="variantId"]').selectOption('');
      await uploadForm.locator('input[name="altTextFr"]').fill(altTextFr);
      await uploadForm.locator('input[name="altTextAr"]').fill(altTextAr);
      const primary = uploadForm.locator('input[name="isPrimary"]');
      if (isPrimary) await primary.check();
      else await primary.uncheck();
      const response = page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === mediaListPath &&
          candidate.request().method() === 'POST',
      );
      const refresh = waitForMediaRefresh();
      const uploadButton = uploadForm.getByRole('button', { name: /Téléverser/ });
      await uploadButton.click();
      const [uploaded] = await Promise.all([response, refresh]);
      expect(uploaded.status()).toBe(201);
      const image = ((await uploaded.json()) as { data: AdminProductImage }).data;
      await expect(imageCard(altTextFr)).toHaveCount(1);
      await expectLoadedImage(imageCard(altTextFr).locator('img'));
      await expect(uploadButton).toBeEnabled();
      return image;
    };
    const productImage = await uploadManagedImage(
      mediaFixturePaths[0],
      'Produit administré E2E',
      'منتج إدارة E2E',
      true,
    );
    const galleryImage = await uploadManagedImage(
      mediaFixturePaths[1],
      'Galerie administrée E2E',
      'معرض إدارة E2E',
      false,
    );
    expect(productImage).toMatchObject({
      productId: managedProductId,
      variantId: null,
      isPrimary: true,
      moderationStatus: 'APPROVED',
    });
    expect(galleryImage).toMatchObject({
      productId: managedProductId,
      variantId: null,
      isPrimary: false,
      moderationStatus: 'APPROVED',
    });

    await variantForm.getByRole('link', { name: 'Gérer le stock' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/inventory/${managedVariantId}$`));
    const receiptForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Enregistrer la réception', exact: true }),
    });
    const fulfillmentOption = receiptForm
      .locator('select[name="locationId"] option')
      .filter({ hasText: 'E2E-FULFILLMENT' });
    await expect(fulfillmentOption).toHaveCount(1);
    const locationId = await fulfillmentOption.getAttribute('value');
    if (!locationId) throw new Error('The fulfillment location was not available in the UI');
    await receiptForm.locator('select[name="locationId"]').selectOption(locationId);
    await receiptForm.locator('input[name="batchNumber"]').fill('E2E-MANAGED-BATCH-RECEIPT');
    await receiptForm.locator('input[name="quantity"]').fill('2');
    await receiptForm.locator('input[name="expiryDate"]').fill('2030-12-31');
    await receiptForm.locator('input[name="manufacturedAt"]').fill('2026-01-01');
    await receiptForm
      .locator('input[name="supplierReference"]')
      .fill('PLAYWRIGHT-MANAGED-RECEIPT-001');
    await receiptForm
      .locator('input[name="note"]')
      .fill('Managed product operational browser receipt');
    const receiptResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/admin/inventory/batches/receipts' &&
        candidate.request().method() === 'POST',
    );
    await receiptForm.getByRole('button', { name: 'Enregistrer la réception' }).click();
    const receiptHttp = await receiptResponse;
    expect(receiptHttp.status()).toBe(201);
    const received = (
      (await receiptHttp.json()) as {
        data: {
          batch: { id: string };
          inventoryItemId: string;
          movementId: string;
          quantityReceived: number;
          replayed: boolean;
        };
      }
    ).data;
    expect(received).toMatchObject({ quantityReceived: 2, replayed: false });
    expect(received.batch.id).toBeTruthy();
    expect(received.inventoryItemId).toBeTruthy();
    expect(received.movementId).toBeTruthy();
    await expect(page.locator('.form-success[role="status"]')).toContainText(
      'La réception et son mouvement de stock ont été enregistrés.',
    );
    const receiptRequest = receiptHttp.request();
    const receiptKey = receiptRequest.headers()['idempotency-key'];
    if (!receiptKey) throw new Error('The inventory receipt idempotency key was not sent');
    expect(receiptKey).toMatch(/^admin-web-[0-9a-f-]{36}$/);
    const receiptBody: unknown = receiptRequest.postDataJSON();
    expect(receiptBody).toMatchObject({
      variantId: managedVariantId,
      locationId,
      batchNumber: 'E2E-MANAGED-BATCH-RECEIPT',
      quantity: 2,
    });
    const replayed = await adminApi<{ quantityReceived: number; replayed: boolean }>(
      context,
      'POST',
      '/admin/inventory/batches/receipts',
      receiptBody,
      { 'Idempotency-Key': receiptKey },
    );
    expect(replayed).toMatchObject({ quantityReceived: 2, replayed: true });

    await page.goto(`/admin/catalog/${managedProductId}/edit`);
    await page.getByRole('heading', { name: 'Variantes, prix et seuils', exact: true }).click();
    variantForm = page.locator('form.admin-panel').filter({ hasText: 'E2E-ADMIN-CITRON-V1' });
    await expect(variantForm).toBeVisible();
    await variantForm.locator('input[name="color"]').fill('Jaune électrique');
    await variantForm.locator('select[name="publicationStatus"]').selectOption('PUBLISHED');
    const variantPublishResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/products/${managedProductId}/variants/${managedVariantId}` &&
        candidate.request().method() === 'PATCH',
    );
    await variantForm.getByRole('button', { name: 'Mettre à jour la variante' }).click();
    const publishedVariantHttp = await variantPublishResponse;
    expect(publishedVariantHttp.status()).toBe(200);
    const publishedVariant = (
      (await publishedVariantHttp.json()) as {
        data: AdminManagedVariant;
      }
    ).data;
    expect(publishedVariant.id).toBe(managedVariantId);
    expect(publishedVariant).toMatchObject({
      color: 'Jaune électrique',
      publicationStatus: 'PUBLISHED',
    });

    const publishProductForm = page.locator('.admin-editor > form');
    await publishProductForm.locator('select[name="publicationStatus"]').selectOption('PUBLISHED');
    await publishProductForm.locator('input[name="featured"]').check();
    const productPublishResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `/api/v1/admin/products/${managedProductId}` &&
        candidate.request().method() === 'PATCH',
    );
    await publishProductForm.getByRole('button', { name: 'Enregistrer le produit' }).click();
    const publishedProductHttp = await productPublishResponse;
    expect(publishedProductHttp.status()).toBe(200);
    const publishedProduct = (
      (await publishedProductHttp.json()) as {
        data: AdminManagedProduct;
      }
    ).data;
    expect(publishedProduct.id).toBe(managedProductId);
    expect(publishedProduct).toMatchObject({ publicationStatus: 'PUBLISHED', featured: true });
    await expect(page).toHaveURL(/\/admin\/catalog$/);

    const persistedProduct = await adminApi<AdminManagedProduct>(
      context,
      'GET',
      `/admin/products/${managedProductId}`,
    );
    const persistedVariants = await adminApi<PageResult<AdminManagedVariant>>(
      context,
      'GET',
      `/admin/products/${managedProductId}/variants?page=1&pageSize=50`,
    );
    expect(persistedProduct).toMatchObject({ publicationStatus: 'PUBLISHED', featured: true });
    expect(persistedVariants.items.find(({ id }) => id === managedVariantId)).toMatchObject({
      color: 'Jaune électrique',
      publicationStatus: 'PUBLISHED',
    });
    await expect(page.getByText('Produit E2E administré modifié', { exact: true })).toBeVisible();
  });

  await test.step('customer registration and separate customer login', async () => {
    await page.goto('/register');
    await confirmAge(page);

    await page.locator('input[name="fullName"]').fill('Client Opérationnel E2E');
    await page.locator('input[name="email"]').fill(customerEmail);
    await page.locator('input[name="phone"]').fill(customerPhone);
    await page.locator('input[name="password"]').fill(customerPassword);
    await page.locator('input[name="confirmPassword"]').fill(customerPassword);
    await page.locator('input[name="adultConfirmed"]').check();
    await page.locator('input[name="termsAccepted"]').check();
    const registrationResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/auth/customer/register' &&
        candidate.request().method() === 'POST',
    );
    await page.locator('.auth-card form button[type="submit"]').click();
    expect((await registrationResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Informations personnelles' })).toBeVisible();

    await context.clearCookies({ name: /^(?:__Host-)?vape_customer_/ });
    await page.goto('/login');
    await confirmAge(page);
    await page.locator('input[name="emailOrPhone"]').fill(customerEmail);
    await page.locator('input[name="password"]').fill(customerPassword);
    const loginResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/auth/customer/login' &&
        candidate.request().method() === 'POST',
    );
    await page.locator('.auth-card form button[type="submit"]').click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/account$/);
  });

  await test.step('French search/filter, Arabic RTL, and mobile navigation', async () => {
    await page.goto('/');
    await expect(page.getByText('Produit E2E administré modifié', { exact: true })).toBeVisible();
    await page.goto('/catalog');
    await expect(page.getByText('Produit E2E administré modifié', { exact: true })).toBeVisible();
    await expect(page.getByText('PuffJet Menthe Opérationnelle', { exact: true })).toBeVisible();
    await page.locator('.catalog-filters input[name="q"]').fill('Menthe');
    await page.locator('select[name="brand"]').selectOption('puffjet-e2e');
    await page.locator('select[name="productType"]').selectOption('DISPOSABLE');
    await page.locator('select[name="flavor"]').selectOption('Menthe E2E');
    await page.locator('input[name="minimumPrice"]').fill('5');
    await page.locator('input[name="maximumPrice"]').fill('15');
    const filteredResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/products' &&
        new URL(candidate.url()).searchParams.get('flavor') === 'Menthe E2E',
    );
    await page.getByRole('button', { name: 'Appliquer' }).click();
    expect((await filteredResponse).status()).toBe(200);
    await expect(page).toHaveURL(/productType=DISPOSABLE/);
    await expect(page).toHaveURL(/flavor=Menthe(?:\+|%20)E2E/);
    await expect(page.getByText('PuffJet Menthe Opérationnelle', { exact: true })).toBeVisible();

    await page.locator('.language-switch button').last().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('.language-switch button').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await page.locator('.menu-toggle').click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await expect(
      page.locator('#mobile-menu').getByRole('link', { name: 'Livraison' }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step('available variant selection, cart edit, and keyboard checkout navigation', async () => {
    await page.goto('/products/admin-created-e2e-product');
    await expect(
      page.getByRole('heading', { name: 'Produit E2E administré modifié' }),
    ).toBeVisible();
    const managedVariant = page.getByRole('radio', { name: /Citron électrique E2E/ });
    await expect(managedVariant).toBeEnabled();
    await managedVariant.check();
    await expect(managedVariant).toBeChecked();
    const addResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/cart/items' &&
        candidate.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ajouter au panier' }).click();
    expect((await addResponse).status()).toBe(201);

    await page.goto('/cart');
    const quantity = page.locator('output[aria-label="Quantité"]');
    const incrementResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/v1\/cart\/items\//.test(new URL(candidate.url()).pathname) &&
        candidate.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Quantité +' }).click();
    expect((await incrementResponse).status()).toBe(200);
    await expect(quantity).toHaveText('2');
    const decrementResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/v1\/cart\/items\//.test(new URL(candidate.url()).pathname) &&
        candidate.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Quantité -' }).click();
    expect((await decrementResponse).status()).toBe(200);
    await expect(quantity).toHaveText('1');

    const checkoutLink = page.getByRole('link', { name: /Passer .* la livraison/ });
    await checkoutLink.focus();
    await expect(checkoutLink).toBeFocused();
    await checkoutLink.press('Enter');
    await expect(page).toHaveURL(/\/checkout$/);
  });

  await test.step('atomic COD checkout and idempotent network retry', async () => {
    await page.locator('input[name="fullName"]').fill('Client Opérationnel E2E');
    await page.locator('input[name="phone"]').fill(customerPhone);
    await page.locator('input[name="email"]').fill(customerEmail);

    const delegationResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/v1\/geography\/governorates\/[^/]+\/delegations$/.test(
          new URL(candidate.url()).pathname,
        ) && candidate.request().method() === 'GET',
    );
    await page.locator('select[name="governorateId"]').selectOption({ label: 'Bizerte' });
    expect((await delegationResponse).status()).toBe(200);

    const localityResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/v1\/geography\/delegations\/[^/]+\/localities$/.test(
          new URL(candidate.url()).pathname,
        ) && candidate.request().method() === 'GET',
    );
    await page.locator('select[name="delegationId"]').selectOption({ label: 'Bizerte Nord' });
    expect((await localityResponse).status()).toBe(200);

    await expect(
      page.locator('select[name="localityId"] option', { hasText: 'El corniche' }),
    ).toHaveCount(0);
    const unsupportedMethodsResponse = await context.request.get(
      `${apiUrl}/api/v1/delivery/methods?localityId=${encodeURIComponent(unsupportedBizerteLocalityId)}`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'fr' } },
    );
    expect(unsupportedMethodsResponse.status()).toBe(200);
    expect((await unsupportedMethodsResponse.json()) as { data: DeliveryMethod[] }).toEqual({
      data: [],
    });

    const methodsResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/delivery/methods' &&
        new URL(candidate.url()).searchParams.has('localityId'),
    );
    await page.locator('select[name="localityId"]').selectOption({ label: 'La medina' });
    const methodsHttp = await methodsResponse;
    expect(methodsHttp.status()).toBe(200);
    const methods = ((await methodsHttp.json()) as { data: DeliveryMethod[] }).data;
    expect(methods).toEqual([
      expect.objectContaining({
        type: 'COURIER',
        label: 'Bizerte Express E2E',
        estimatedMinMinutes: 30,
        estimatedMaxMinutes: 50,
        paymentMethod: 'CASH_ON_DELIVERY',
        phoneConfirmationRequired: false,
      }),
    ]);
    await expect(page.locator('input[name="postalCode"]')).toHaveValue('7000');
    await page.locator('input[name="street"]').fill('Rue Habib Bougatfa, La Médina, Bizerte');

    const methodSelect = page.locator('select[name="deliveryMethodId"]');
    await expect(methodSelect.locator('option')).toHaveCount(2);
    const courierValue = await methodSelect.locator('option').nth(1).getAttribute('value');
    expect(courierValue).toMatch(/^courier:/);
    const quoteResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/checkout/quote' &&
        candidate.request().method() === 'POST',
    );
    await methodSelect.selectOption(courierValue);
    const quoteHttp = await quoteResponse;
    expect(quoteHttp.status()).toBe(201);
    expect((await quoteHttp.json()) as { data: { fulfillment: unknown } }).toMatchObject({
      data: {
        fulfillment: {
          type: 'COURIER',
          estimatedMinMinutes: 30,
          estimatedMaxMinutes: 50,
          paymentMethod: 'CASH_ON_DELIVERY',
          phoneConfirmationRequired: false,
        },
      },
    });

    await page.locator('input[name="adultConfirmation"]').check();
    await page.locator('input[name="termsAccepted"]').check();
    await page.locator('input[name="privacyAccepted"]').check();
    const checkoutResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/checkout/orders' &&
        candidate.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Confirmer la commande/ }).click();
    const completedCheckout = await checkoutResponse;
    expect(completedCheckout.status()).toBe(201);
    const checkoutRequest = completedCheckout.request();
    const idempotencyKey = checkoutRequest.headers()['idempotency-key'];
    const csrfToken = checkoutRequest.headers()['x-csrf-token'];
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(csrfToken).toBeTruthy();
    checkout = ((await completedCheckout.json()) as { data: CheckoutResult }).data;
    expect(checkout).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      paymentStatus: 'CASH_EXPECTED',
      subtotalMillimes: 13_000,
      deliveryTotalMillimes: 8_000,
      taxTotalMillimes: 0,
      grandTotalMillimes: 21_000,
      fulfillment: {
        type: 'COURIER',
        estimatedMinDays: null,
        estimatedMaxDays: null,
        estimatedMinMinutes: 30,
        estimatedMaxMinutes: 50,
        paymentMethod: 'CASH_ON_DELIVERY',
        phoneConfirmationRequired: false,
      },
    });
    await expect(page).toHaveURL(new RegExp(`/order-confirmation/${checkout.orderNumber}$`));

    const checkoutPayload: unknown = checkoutRequest.postDataJSON();
    const replay = await context.request.post(`${apiUrl}/api/v1/checkout/orders`, {
      data: checkoutPayload,
      headers: {
        Origin: webUrl,
        'X-Client-Context': 'customer',
        'X-CSRF-Token': csrfToken!,
        'Idempotency-Key': idempotencyKey!,
      },
    });
    expect([200, 201]).toContain(replay.status());
    expect(((await replay.json()) as { data: CheckoutResult }).data.id).toBe(checkout.id);

    await page.goto('/account/orders');
    await expect(page.getByRole('heading', { name: 'Historique des commandes' })).toBeVisible();
    await expect(page.getByText(checkout.orderNumber, { exact: true })).toBeVisible();
  });

  await test.step('customer and administrator sessions remain realm-separated', async () => {
    const [customerSession, adminSession] = await Promise.all([
      context.request.get(`${apiUrl}/api/v1/auth/customer/session`, {
        headers: { 'X-Client-Context': 'customer' },
      }),
      context.request.get(`${apiUrl}/api/v1/auth/admin/session`, {
        headers: { 'X-Client-Context': 'admin' },
      }),
    ]);
    expect(customerSession.status()).toBe(200);
    expect(adminSession.status()).toBe(200);
  });

  await test.step('administrator manages the complete product-media lifecycle', async () => {
    const products = await adminApi<PageResult<AdminProductSummary>>(
      context,
      'GET',
      '/admin/products?page=1&limit=20&q=puffjet-menthe-operationnelle',
    );
    const product = products.items.find(({ slug }) => slug === 'puffjet-menthe-operationnelle');
    expect(product).toBeTruthy();
    const variants = await adminApi<PageResult<AdminVariantSummary>>(
      context,
      'GET',
      `/admin/products/${product!.id}/variants?page=1&pageSize=50`,
    );
    const variant = variants.items.find(({ sku }) => sku === 'E2E-PUFFJET-MINT-V1');
    expect(variant).toBeTruthy();

    await page.goto(`/admin/catalog/${product!.id}/edit`);
    await page.getByRole('heading', { name: 'Images du produit', exact: true }).click();
    const uploadForm = page.locator('.admin-media-upload');
    await expect(page.locator('#product-media-title')).toBeVisible();
    await expect(uploadForm.locator('select[name="variantId"] option')).toHaveCount(2);

    const mediaListPath = `/api/v1/admin/products/${product!.id}/images`;
    const imageCard = (altText: string) =>
      page.locator('.admin-media-card').filter({
        has: page.getByRole('img', { name: altText, exact: true }),
      });
    const waitForMediaRefresh = () =>
      page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === mediaListPath &&
          candidate.request().method() === 'GET' &&
          candidate.status() === 200,
      );
    const uploadImage = async ({
      fixturePath,
      altTextFr,
      altTextAr,
      variantId,
      isPrimary,
    }: {
      fixturePath: string;
      altTextFr: string;
      altTextAr: string;
      variantId?: string;
      isPrimary: boolean;
    }): Promise<AdminProductImage> => {
      await uploadForm.locator('input[name="file"]').setInputFiles(fixturePath);
      await uploadForm.locator('select[name="variantId"]').selectOption(variantId ?? '');
      await uploadForm.locator('input[name="altTextFr"]').fill(altTextFr);
      await uploadForm.locator('input[name="altTextAr"]').fill(altTextAr);
      const primary = uploadForm.locator('input[name="isPrimary"]');
      if (isPrimary) await primary.check();
      else await primary.uncheck();
      const mutation = page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === mediaListPath &&
          candidate.request().method() === 'POST',
      );
      const refresh = waitForMediaRefresh();
      const uploadButton = uploadForm.getByRole('button', { name: 'Téléverser l’image' });
      await uploadButton.click();
      const [response] = await Promise.all([mutation, refresh]);
      expect(response.status()).toBe(201);
      const image = ((await response.json()) as { data: AdminProductImage }).data;
      await expect(imageCard(altTextFr)).toHaveCount(1);
      await expectLoadedImage(imageCard(altTextFr).locator('img'));
      await expect(uploadButton).toBeEnabled();
      return image;
    };

    const primaryImage = await uploadImage({
      fixturePath: mediaFixturePaths[0],
      altTextFr: 'Image principale E2E',
      altTextAr: 'صورة E2E الرئيسية',
      isPrimary: true,
    });
    const baselineCard = imageCard('Catalogue E2E baseline');
    await expect(baselineCard).toHaveCount(1);
    page.once('dialog', (dialog) => void dialog.accept());
    const baselineDeletionResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname.startsWith(`${mediaListPath}/`) &&
        candidate.request().method() === 'DELETE',
    );
    const baselineDeletionRefresh = waitForMediaRefresh();
    await baselineCard.getByRole('button', { name: 'Supprimer' }).click();
    expect((await baselineDeletionResponse).status()).toBe(200);
    await baselineDeletionRefresh;
    await expect(baselineCard).toHaveCount(0);
    const galleryImage = await uploadImage({
      fixturePath: mediaFixturePaths[1],
      altTextFr: 'Galerie produit E2E',
      altTextAr: 'معرض منتج E2E',
      isPrimary: false,
    });
    await uploadImage({
      fixturePath: mediaFixturePaths[2],
      altTextFr: 'Variante menthe E2E',
      altTextAr: 'نكهة النعناع E2E',
      variantId: variant!.id,
      isPrimary: true,
    });

    let galleryCard = imageCard('Galerie produit E2E');
    const reorderResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `${mediaListPath}/reorder` &&
        candidate.request().method() === 'POST',
    );
    const reorderRefresh = waitForMediaRefresh();
    await galleryCard.getByRole('button', { name: 'Déplacer l’image vers le haut' }).click();
    expect((await reorderResponse).status()).toBe(201);
    await reorderRefresh;

    galleryCard = imageCard('Galerie produit E2E');
    const primaryResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `${mediaListPath}/${galleryImage.id}/primary` &&
        candidate.request().method() === 'POST',
    );
    const primaryRefresh = waitForMediaRefresh();
    await galleryCard.getByRole('button', { name: 'Définir comme principale' }).click();
    const primaryMutation = await primaryResponse;
    expect(primaryMutation.status(), await primaryMutation.text()).toBe(201);
    await primaryRefresh;

    let originalCard = imageCard('Image principale E2E');
    await originalCard.locator('input[name="altTextFr"]').fill('Image secondaire modifiée E2E');
    await originalCard.locator('input[name="altTextAr"]').fill('صورة E2E ثانوية معدلة');
    const metadataResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `${mediaListPath}/${primaryImage.id}` &&
        candidate.request().method() === 'PATCH',
    );
    const metadataRefresh = waitForMediaRefresh();
    await originalCard.getByRole('button', { name: 'Enregistrer' }).click();
    expect((await metadataResponse).status()).toBe(200);
    await metadataRefresh;
    await expect(imageCard('Image secondaire modifiée E2E')).toHaveCount(1);

    originalCard = imageCard('Image secondaire modifiée E2E');
    const originalSource = await originalCard.locator('img').getAttribute('src');
    expect(originalSource).toBeTruthy();
    await originalCard.locator('input[type="file"]').setInputFiles(mediaFixturePaths[3]);
    const replacementResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `${mediaListPath}/${primaryImage.id}/replace` &&
        candidate.request().method() === 'POST',
    );
    const replacementRefresh = waitForMediaRefresh();
    await originalCard
      .locator('.admin-media-replace button[type="submit"]')
      .filter({ hasText: 'Remplacer le fichier' })
      .click();
    const replacementHttp = await replacementResponse;
    expect(replacementHttp.status()).toBe(201);
    const replacementImage = ((await replacementHttp.json()) as { data: AdminProductImage }).data;
    await replacementRefresh;
    originalCard = imageCard('Image secondaire modifiée E2E');
    await expect
      .poll(() => originalCard.locator('img').getAttribute('src'))
      .not.toBe(originalSource);
    await expectLoadedImage(originalCard.locator('img'));

    page.once('dialog', (dialog) => void dialog.accept());
    const deletionResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `${mediaListPath}/${replacementImage.id}` &&
        candidate.request().method() === 'DELETE',
    );
    const deletionRefresh = waitForMediaRefresh();
    await originalCard.getByRole('button', { name: 'Supprimer' }).click();
    const deletionHttp = await deletionResponse;
    expect(deletionHttp.status()).toBe(200);
    expect((await deletionHttp.json()) as { data: unknown }).toMatchObject({
      data: { id: replacementImage.id, deleted: true },
    });
    const deletionRefreshHttp = await deletionRefresh;
    expect(deletionRefreshHttp.status()).toBe(200);
    const deletionRefreshPayload = (await deletionRefreshHttp.json()) as {
      data: PageResult<AdminProductImage>;
    };
    expect(deletionRefreshPayload.data.items.map(({ id }) => id)).not.toContain(
      replacementImage.id,
    );
    await expect(imageCard('Image secondaire modifiée E2E')).toHaveCount(0);

    const persistedImages = await adminApi<PageResult<AdminProductImage>>(
      context,
      'GET',
      `/admin/products/${product!.id}/images?page=1&pageSize=50`,
    );
    expect(persistedImages.items).toHaveLength(2);
    expect(persistedImages.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: product!.id,
          variantId: null,
          altTextFr: 'Galerie produit E2E',
          isPrimary: true,
        }),
        expect.objectContaining({
          productId: null,
          variantId: variant!.id,
          altTextFr: 'Variante menthe E2E',
          isPrimary: true,
        }),
      ]),
    );

    await page.goto('/products/puffjet-menthe-operationnelle');
    let storefrontImage = page.locator('.product-gallery__main');
    await expect(storefrontImage).toHaveAttribute('alt', 'Variante menthe E2E');
    await expectLoadedImage(storefrontImage);
    await page.getByRole('button', { name: /Galerie produit E2E/ }).click();
    storefrontImage = page.locator('.product-gallery__main');
    await expect(storefrontImage).toHaveAttribute('alt', 'Galerie produit E2E');
    await expectLoadedImage(storefrontImage);
  });

  await test.step('generic catalogue import previews, applies, and replays without duplicates', async () => {
    const importKey = 'operational-generic-import-v1';
    const genericMediaSourceUrl =
      'https://catalog-media-fixture.invalid/generic-import.png?ignored=query#ignored-fragment';
    const genericMediaAlt = 'PuffJet Media Operationnelle E2E';
    const importRow = {
      schemaVersion: '1.0',
      productKey: 'operational-generic-product',
      brand: 'PuffJet E2E',
      categorySlug: 'jetables-e2e',
      family: 'PuffJet',
      model: 'Import E2E',
      productType: 'DISPOSABLE',
      nameFr: 'Produit générique importé E2E',
      nameAr: 'منتج E2E عام مستورد',
      slug: 'operational-imported-e2e-product',
      puffCount: 7_000,
      liquidCapacityMl: 14,
      containsNicotine: true,
      nicotineStrengthMg: 5,
      variantKey: 'operational-citrus',
      variantNameFr: 'Agrumes opérationnels E2E',
      variantNameAr: 'حمضيات تشغيلية E2E',
      flavorCanonical: 'Operational Citrus',
      flavorNameFr: 'Agrumes opérationnels',
      flavorNameAr: 'حمضيات تشغيلية',
      flavorCategory: 'FRUIT',
      color: null,
      sku: 'E2E-GENERIC-IMPORT-CITRUS',
      priceMillimes: null,
      publicationStatus: null,
      officialProductUrl: null,
      productImageUrl: null,
      variantImageUrl: null,
    };
    const publishedMediaRow = {
      schemaVersion: '1.0',
      productKey: 'operational-published-product-media',
      brand: 'PuffJet E2E',
      categorySlug: 'jetables-e2e',
      family: 'PuffJet',
      model: 'Media E2E',
      productType: 'DISPOSABLE',
      nameFr: genericMediaAlt,
      nameAr: 'منتج صور تشغيلي E2E',
      slug: 'puffjet-menthe-operationnelle',
      puffCount: 6_000,
      liquidCapacityMl: null,
      containsNicotine: true,
      nicotineStrengthMg: 5,
      variantKey: 'operational-published-mint',
      variantNameFr: 'Menthe Media E2E',
      variantNameAr: 'نعناع صور E2E',
      flavorCanonical: null,
      flavorNameFr: null,
      flavorNameAr: null,
      flavorCategory: null,
      color: null,
      sku: 'E2E-PUFFJET-MINT-V1',
      priceMillimes: null,
      publicationStatus: null,
      officialProductUrl: null,
      productImageUrl: genericMediaSourceUrl,
      variantImageUrl: null,
    };

    await page.goto('/admin/catalog/imports');
    const importForm = page
      .locator('.admin-import-card')
      .filter({ has: page.locator('#file-import-title') })
      .locator('form');
    await importForm.locator('input[name="importKey"]').fill(importKey);
    await importForm.locator('select[name="format"]').selectOption('JSON');
    await importForm.locator('input[name="overrideImages"]').check();
    await importForm.locator('input[name="file"]').setInputFiles({
      name: 'operational-catalog.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: '1.0', rows: [importRow, publishedMediaRow] }),
      ),
    });
    const previewResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/admin/catalog/imports/preview' &&
        candidate.request().method() === 'POST',
    );
    await importForm.getByRole('button', { name: 'Valider et prévisualiser' }).click();
    const previewHttp = await previewResponse;
    expect(previewHttp.status()).toBe(201);
    const preview = ((await previewHttp.json()) as { data: CatalogImportBatch }).data;
    expect(preview).toMatchObject({ importKey, dryRun: true, status: 'PREVIEW_VALID' });
    let currentImport = page.locator('.admin-import-detail');
    await expect(currentImport.getByRole('heading', { name: importKey })).toBeVisible();
    await expect(currentImport.getByText('Prévisualisation valide', { exact: true })).toBeVisible();
    const validationReport = currentImport.locator('.admin-import-row-report');
    await expect(
      validationReport.getByText('operational-generic-product:operational-citrus'),
    ).toBeVisible();
    await expect(
      validationReport.getByText('operational-published-product-media:operational-published-mint'),
    ).toBeVisible();
    await expect(validationReport.getByText('Valide', { exact: true })).toHaveCount(2);
    await expect(validationReport.getByText('Aucun problème', { exact: true })).toHaveCount(2);

    await page.getByRole('button', { name: 'Appliquer ce lot' }).click();
    const confirmationDialog = page.getByRole('dialog');
    await confirmationDialog.locator('input[name="confirmation"]').fill('APPLY_CATALOG_IMPORT');
    const applyResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `/api/v1/admin/catalog/imports/${preview.id}/apply` &&
        candidate.request().method() === 'POST',
    );
    await confirmationDialog.getByRole('button', { name: 'Appliquer ce lot' }).click();
    const applyHttp = await applyResponse;
    expect(applyHttp.status()).toBe(201);
    const applied = ((await applyHttp.json()) as { data: CatalogImportBatch }).data;
    expect(applied).toMatchObject({
      importKey,
      dryRun: false,
      status: 'APPLIED_WITH_WARNINGS',
      appliedCount: 2,
    });
    currentImport = page.locator('.admin-import-detail');
    await expect(
      currentImport.getByText('Appliqué avec avertissements', { exact: true }),
    ).toBeVisible();
    await expect(
      currentImport.locator('.admin-import-row-report').getByText('Créée', { exact: true }),
    ).toBeVisible();

    const replay = await adminApi<CatalogImportBatch>(
      context,
      'POST',
      `/admin/catalog/imports/${preview.id}/apply`,
      { confirmation: 'APPLY_CATALOG_IMPORT' },
    );
    expect(replay).toMatchObject({ id: applied.id, appliedCount: 2 });
    const imported = await adminApi<PageResult<AdminProductSummary>>(
      context,
      'GET',
      '/admin/products?page=1&limit=50&q=operational-imported-e2e-product',
    );
    expect(imported.total).toBe(1);
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]?.slug).toBe('operational-imported-e2e-product');

    const publishedProducts = await adminApi<PageResult<AdminProductSummary>>(
      context,
      'GET',
      '/admin/products?page=1&limit=20&q=puffjet-menthe-operationnelle',
    );
    const publishedProduct = publishedProducts.items.find(
      ({ slug }) => slug === 'puffjet-menthe-operationnelle',
    );
    expect(publishedProduct).toBeTruthy();

    const mediaResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname ===
          `/api/v1/admin/catalog/imports/${applied.id}/media/apply` &&
        candidate.request().method() === 'POST',
    );
    await currentImport.getByRole('button', { name: 'Importer les médias du lot' }).click();
    const mediaDialog = page.getByRole('dialog');
    await mediaDialog.locator('input[name="confirmation"]').fill('IMPORT_CATALOG_MEDIA');
    await mediaDialog.getByRole('button', { name: 'Importer les médias du lot' }).click();
    const mediaHttp = await mediaResponse;
    expect(mediaHttp.status()).toBe(201);
    const firstMediaResult = (
      (await mediaHttp.json()) as {
        data: {
          report: {
            successful: Array<{ productKey: string; imageId?: string }>;
            productsRequiringManualReview: string[];
          };
        };
      }
    ).data.report;
    expect(firstMediaResult.successful).toContainEqual(
      expect.objectContaining({ productKey: publishedMediaRow.productKey }),
    );
    expect(firstMediaResult.productsRequiringManualReview).toContain(publishedMediaRow.productKey);

    let importedMedia = await adminApi<PageResult<AdminProductImage>>(
      context,
      'GET',
      `/admin/products/${publishedProduct!.id}/images?page=1&pageSize=50`,
    );
    let candidate = importedMedia.items.find(({ altTextFr }) => altTextFr === genericMediaAlt);
    expect(candidate).toMatchObject({
      productId: publishedProduct!.id,
      variantId: null,
      isPrimary: false,
      moderationStatus: 'PENDING',
    });
    expect(candidate?.url).toBe(
      `/api/v1/admin/products/${publishedProduct!.id}/images/${candidate!.id}/content`,
    );

    const publicBeforeReviewResponse = await context.request.get(
      `${apiUrl}/api/v1/catalog/products/puffjet-menthe-operationnelle`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'fr' } },
    );
    expect(publicBeforeReviewResponse.status()).toBe(200);
    const publicBeforeReview = (
      (await publicBeforeReviewResponse.json()) as { data: PublicProductDetail }
    ).data;
    expect(publicBeforeReview.images.some(({ altText }) => altText === genericMediaAlt)).toBe(
      false,
    );

    const mediaReplay = await adminApi<{
      report: {
        successful: unknown[];
        duplicates: Array<{ productKey: string; imageId?: string; code?: string }>;
      };
    }>(context, 'POST', `/admin/catalog/imports/${applied.id}/media/apply`, {
      confirmation: 'IMPORT_CATALOG_MEDIA',
    });
    expect(mediaReplay.report.successful).toHaveLength(0);
    expect(mediaReplay.report.duplicates).toContainEqual(
      expect.objectContaining({ productKey: publishedMediaRow.productKey, imageId: candidate!.id }),
    );
    importedMedia = await adminApi<PageResult<AdminProductImage>>(
      context,
      'GET',
      `/admin/products/${publishedProduct!.id}/images?page=1&pageSize=50`,
    );
    expect(
      importedMedia.items.filter(({ altTextFr }) => altTextFr === genericMediaAlt),
    ).toHaveLength(1);

    await page.goto(`/admin/catalog/${publishedProduct!.id}/edit`);
    await page.getByRole('heading', { name: 'Images du produit', exact: true }).click();
    await page.getByLabel('Afficher uniquement les images en attente de contrôle').check();
    const pendingCard = page.locator('.admin-media-card').filter({
      has: page.getByRole('img', { name: genericMediaAlt, exact: true }),
    });
    await expect(pendingCard).toHaveCount(1);
    await expectLoadedImage(pendingCard.locator('img'));
    const reviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/admin/products/${publishedProduct!.id}/images/${candidate!.id}/review` &&
        response.request().method() === 'POST',
    );
    await pendingCard.getByRole('button', { name: 'Approuver l’image' }).click();
    expect([200, 201]).toContain((await reviewResponse).status());
    await expect(pendingCard).toHaveCount(0);

    await page.getByLabel('Afficher uniquement les images en attente de contrôle').uncheck();
    let approvedCard = page.locator('.admin-media-card').filter({
      has: page.getByRole('img', { name: genericMediaAlt, exact: true }),
    });
    await expect(approvedCard).toHaveCount(1);
    importedMedia = await adminApi<PageResult<AdminProductImage>>(
      context,
      'GET',
      `/admin/products/${publishedProduct!.id}/images?page=1&pageSize=50`,
    );
    candidate = importedMedia.items.find(({ id }) => id === candidate!.id);
    expect(candidate).toMatchObject({ moderationStatus: 'APPROVED', isPrimary: false });

    const publicAfterReviewResponse = await context.request.get(
      `${apiUrl}/api/v1/catalog/products/puffjet-menthe-operationnelle`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'fr' } },
    );
    expect(publicAfterReviewResponse.status()).toBe(200);
    const publicAfterReview = (
      (await publicAfterReviewResponse.json()) as { data: PublicProductDetail }
    ).data;
    expect(publicAfterReview.images.some(({ altText }) => altText === genericMediaAlt)).toBe(true);
    expect(publicAfterReview.primaryImage?.altText).not.toBe(genericMediaAlt);

    const primaryResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/admin/products/${publishedProduct!.id}/images/${candidate!.id}/primary` &&
        response.request().method() === 'POST',
    );
    approvedCard = page.locator('.admin-media-card').filter({
      has: page.getByRole('img', { name: genericMediaAlt, exact: true }),
    });
    await approvedCard.getByRole('button', { name: 'Définir comme principale' }).click();
    expect([200, 201]).toContain((await primaryResponse).status());

    const publicAfterPrimaryResponse = await context.request.get(
      `${apiUrl}/api/v1/catalog/products/puffjet-menthe-operationnelle`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'fr' } },
    );
    expect(publicAfterPrimaryResponse.status()).toBe(200);
    const publicAfterPrimary = (
      (await publicAfterPrimaryResponse.json()) as { data: PublicProductDetail }
    ).data;
    expect(publicAfterPrimary.primaryImage).toMatchObject({ altText: genericMediaAlt });
    expect(publicAfterPrimary.primaryImage?.url).toMatch(/^\/api\/v1\/media\/[a-f0-9]{64}$/);
    const publicMediaResponse = await context.request.get(
      `${apiUrl}${publicAfterPrimary.primaryImage!.url}`,
    );
    expect(publicMediaResponse.status()).toBe(200);
    expect(publicMediaResponse.headers()['content-type']).toBe('image/png');
    expect((await publicMediaResponse.body()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    await page.goto('/products/puffjet-menthe-operationnelle');
    await page.getByRole('button', { name: new RegExp(genericMediaAlt) }).click();
    const importedStorefrontImage = page.locator('.product-gallery__main');
    await expect(importedStorefrontImage).toHaveAttribute('alt', genericMediaAlt);
    await expectLoadedImage(importedStorefrontImage);
  });

  await test.step('order confirmation, delivery assignment, and COD collection', async () => {
    let order = await adminApi<AdminOrder>(context, 'GET', `/admin/orders/${checkout.id}`);
    order = await adminApi<AdminOrder>(context, 'POST', `/admin/orders/${checkout.id}/confirm`, {
      expectedVersion: order.version,
      confirmed: true,
    });
    expect(order.status).toBe('CONFIRMED');
    order = await adminApi<AdminOrder>(context, 'POST', `/admin/orders/${checkout.id}/prepare`, {
      expectedVersion: order.version,
    });
    expect(order.status).toBe('PREPARING');

    const courier = await adminApi<{ id: string; code: string }>(
      context,
      'POST',
      '/admin/deliveries/courier-records',
      {
        code: 'E2E-DRIVER-01',
        name: 'Chauffeur manuel E2E',
        contactName: 'Opérateur E2E',
        phoneE164: '+21620123456',
        confirmation: 'CREATE_MANUAL_COURIER',
      },
    );
    let delivery = await adminApi<AdminDelivery>(
      context,
      'GET',
      `/admin/deliveries/${order.delivery.id}`,
    );
    delivery = await adminApi<AdminDelivery>(
      context,
      'POST',
      `/admin/deliveries/${delivery.id}/assign`,
      { expectedVersion: delivery.version, courierId: courier.id, trackingNumber: 'E2E-TRACK-001' },
    );
    for (const targetStatus of [
      'ASSIGNED_TO_COURIER',
      'HANDED_TO_COURIER',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
    ]) {
      delivery = await adminApi<AdminDelivery>(
        context,
        'POST',
        `/admin/deliveries/${delivery.id}/transitions`,
        { expectedVersion: delivery.version, targetStatus },
      );
      expect(delivery.status).toBe(targetStatus);
    }

    const collections = await adminApi<PageResult<{ id: string; orderNumber: string }>>(
      context,
      'GET',
      `/admin/cash/collections?page=1&limit=50&q=${encodeURIComponent(checkout.orderNumber)}`,
    );
    const collectionId = collections.items.find(
      ({ orderNumber }) => orderNumber === checkout.orderNumber,
    )?.id;
    expect(collectionId).toBeTruthy();
    const collection = await adminApi<CashCollection>(
      context,
      'GET',
      `/admin/cash/collections/${collectionId}`,
    );
    const collectionBody = {
      collectedMillimes: checkout.expectedCodMillimes,
      expectedOrderVersion: collection.orderVersion,
      expectedDeliveryVersion: collection.delivery.version,
      confirmation: 'RECORD_COLLECTION',
    };
    const collectionKey = randomUUID();
    const recorded = await adminApi<CashCollection>(
      context,
      'POST',
      `/admin/cash/collections/${collection.id}/record`,
      collectionBody,
      { 'Idempotency-Key': collectionKey },
    );
    expect(recorded).toMatchObject({
      status: 'COLLECTED',
      collectedMillimes: checkout.expectedCodMillimes,
    });
    const recordedReplay = await adminApi<CashCollection>(
      context,
      'POST',
      `/admin/cash/collections/${collection.id}/record`,
      collectionBody,
      { 'Idempotency-Key': collectionKey },
    );
    expect(recordedReplay.status).toBe('COLLECTED');

    delivery = await adminApi<AdminDelivery>(context, 'GET', `/admin/deliveries/${delivery.id}`);
    delivery = await adminApi<AdminDelivery>(
      context,
      'POST',
      `/admin/deliveries/${delivery.id}/complete`,
      {
        expectedVersion: delivery.version,
        ageVerificationResult: delivery.ageVerificationRequired ? 'PASSED' : 'NOT_REQUIRED',
        confirmation: 'COMPLETE_DELIVERY',
      },
    );
    expect(delivery.status).toBe('DELIVERED');

    const remittance = await adminApi<{ id: string; status: string }>(
      context,
      'POST',
      '/admin/cash/remittances',
      {
        courierId: courier.id,
        remittanceNumber: 'E2E-REMITTANCE-001',
        declaredMillimes: checkout.expectedCodMillimes,
        allocations: [
          { cashCollectionId: collection.id, amountMillimes: checkout.expectedCodMillimes },
        ],
        confirmation: 'CREATE_REMITTANCE',
      },
    );
    remittanceId = remittance.id;
    const submitted = await adminApi<{ id: string; status: string }>(
      context,
      'POST',
      `/admin/cash/remittances/${remittance.id}/submit`,
      { confirmation: 'SUBMIT_REMITTANCE' },
    );
    expect(submitted.status).toBe('SUBMITTED');
  });

  await test.step('inventory and COD CSV exports are downloadable and bounded', async () => {
    for (const path of [
      '/admin/inventory/export.csv?q=E2E',
      '/admin/cash/collections/export.csv',
      '/admin/cash/remittances/export.csv',
    ]) {
      const response = await adminRaw(context, 'GET', path, undefined, { Accept: 'text/csv' });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/csv');
      expect((await response.text()).split('\n').length).toBeGreaterThan(1);
    }
  });

  await test.step('checkout-disabled and maintenance technical settings affect the storefront', async () => {
    await page.goto('/products/puffjet-menthe-operationnelle');
    const addResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/cart/items' &&
        candidate.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ajouter au panier' }).click();
    expect((await addResponse).status()).toBe(201);

    const settings = await adminApi<PageResult<SettingRecord>>(
      context,
      'GET',
      '/admin/settings?page=1&limit=50',
    );
    const checkoutSetting = settings.items.find(({ key }) => key === 'checkout.enabled');
    const maintenanceSetting = settings.items.find(({ key }) => key === 'maintenance.mode');
    expect(checkoutSetting).toBeTruthy();
    expect(maintenanceSetting).toBeTruthy();

    const checkoutDisabled = await adminApi<SettingRecord>(
      context,
      'PATCH',
      '/admin/settings/store/checkout.enabled',
      {
        value: false,
        expectedVersion: checkoutSetting!.version,
        reason: 'Operational Playwright technical-gate verification',
        confirmed: true,
      },
    );
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: /Passer .* la livraison/ })).toBeDisabled();
    await adminApi<SettingRecord>(context, 'PATCH', '/admin/settings/store/checkout.enabled', {
      value: true,
      expectedVersion: checkoutDisabled.version,
      reason: 'Restore checkout after operational Playwright verification',
      confirmed: true,
    });

    const maintenanceEnabled = await adminApi<SettingRecord>(
      context,
      'PATCH',
      '/admin/settings/store/maintenance.mode',
      {
        value: true,
        expectedVersion: maintenanceSetting!.version,
        reason: 'Operational Playwright maintenance-mode verification',
        confirmed: true,
      },
    );
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'La boutique fait une courte pause.' }),
    ).toBeVisible();
    await adminApi<SettingRecord>(context, 'PATCH', '/admin/settings/store/maintenance.mode', {
      value: false,
      expectedVersion: maintenanceEnabled.version,
      reason: 'Restore storefront after operational Playwright verification',
      confirmed: true,
    });
  });

  await test.step('a different accountant independently reconciles COD', async () => {
    const reconcilerContext = await browser.newContext();
    try {
      const reconcilerPage = await reconcilerContext.newPage();
      await loginAdmin(reconcilerPage, reconcilerEmail, reconcilerPassword);
      const reconciled = await adminApi<{ id: string; status: string; differenceMillimes: number }>(
        reconcilerContext,
        'POST',
        `/admin/cash/remittances/${remittanceId}/reconcile`,
        {
          verifiedMillimes: checkout.expectedCodMillimes,
          confirmation: 'RECONCILE_REMITTANCE',
        },
      );
      expect(reconciled).toMatchObject({ status: 'VERIFIED', differenceMillimes: 0 });
    } finally {
      await reconcilerContext.close();
    }
  });

  await test.step('read-only administrator is denied settings access', async () => {
    const limitedContext = await browser.newContext();
    try {
      const limitedPage = await limitedContext.newPage();
      await loginAdmin(limitedPage, limitedAdminEmail, limitedAdminPassword);
      const denied = await adminRaw(limitedContext, 'GET', '/admin/settings?page=1&limit=20');
      expect(denied.status()).toBe(403);
      expect((await denied.json()) as { code?: string }).toMatchObject({
        code: 'INSUFFICIENT_PERMISSION',
      });
    } finally {
      await limitedContext.close();
    }
  });

  await page.goto('/account/orders');
  await expect(page.getByText(checkout.orderNumber, { exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: /Suivre|Détails/ })
    .first()
    .click();
  await expect(page.getByText(/Livrée|Livré/).first()).toBeVisible();
});

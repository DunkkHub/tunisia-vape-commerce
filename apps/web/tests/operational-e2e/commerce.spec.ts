import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  let checkout!: CheckoutResult;
  let remittanceId = '';

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

    await context.clearCookies();
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
    await page.goto('/catalog');
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

  await test.step('cart add, quantity edit, and keyboard checkout navigation', async () => {
    await page.goto('/products/puffjet-menthe-operationnelle');
    await expect(
      page.getByRole('heading', { name: 'PuffJet Menthe Opérationnelle' }),
    ).toBeVisible();
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
    await page.locator('select[name="governorateId"]').selectOption({ label: 'Tunis' });
    expect((await delegationResponse).status()).toBe(200);

    const localityResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/v1\/geography\/delegations\/[^/]+\/localities$/.test(
          new URL(candidate.url()).pathname,
        ) && candidate.request().method() === 'GET',
    );
    await page.locator('select[name="delegationId"]').selectOption({ label: 'Délégation E2E' });
    expect((await localityResponse).status()).toBe(200);

    const methodsResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/delivery/methods' &&
        new URL(candidate.url()).searchParams.has('localityId'),
    );
    await page.locator('select[name="localityId"]').selectOption({ label: 'Localité E2E' });
    expect((await methodsResponse).status()).toBe(200);
    await page.locator('input[name="postalCode"]').fill('1001');
    await page.locator('input[name="street"]').fill('1 rue du Test Opérationnel');

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
    expect((await quoteResponse).status()).toBe(201);

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
      subtotalMillimes: 10_000,
      deliveryTotalMillimes: 7_000,
      taxTotalMillimes: 1_900,
      grandTotalMillimes: 18_900,
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

  await test.step('super-administrator password, TOTP, and realm-separated session', async () => {
    await loginAdmin(page, adminEmail, adminPassword);
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

  await test.step('administrator creates and edits a product', async () => {
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
    const created = await adminApi<{ id: string; version: number; nameFr: string }>(
      context,
      'POST',
      '/admin/products',
      {
        categoryId,
        brandId,
        nameFr: 'Produit E2E administré',
        nameAr: 'منتج إدارة E2E',
        slug: 'admin-created-e2e-product',
        productType: 'DISPOSABLE',
        flavor: 'Agrumes E2E',
        sku: 'E2E-ADMIN-PRODUCT',
        shortDescriptionFr: 'Créé par le workflow Playwright réel.',
        shortDescriptionAr: 'تم إنشاؤه من خلال اختبار Playwright الحقيقي.',
        containsNicotine: true,
        basePriceMillimes: 12_000,
        warningFr: 'Réservé aux adultes.',
        warningAr: 'مخصص للبالغين.',
        minimumAge: 18,
        featured: false,
      },
    );
    expect(created.nameFr).toBe('Produit E2E administré');
    const updated = await adminApi<{ id: string; version: number; nameFr: string; flavor: string }>(
      context,
      'PATCH',
      `/admin/products/${created.id}`,
      {
        version: created.version,
        nameFr: 'Produit E2E administré modifié',
        flavor: 'Citron E2E',
      },
    );
    expect(updated).toMatchObject({
      id: created.id,
      nameFr: 'Produit E2E administré modifié',
      flavor: 'Citron E2E',
    });
    await page.goto('/admin/catalog');
    await expect(page.getByText('Produit E2E administré modifié', { exact: true })).toBeVisible();
  });

  await test.step('inventory receipt is durable and idempotent', async () => {
    const [inventory, locations] = await Promise.all([
      adminApi<PageResult<{ id: string; sku: string }>>(
        context,
        'GET',
        '/admin/inventory?page=1&limit=20&q=E2E-PUFFJET-MINT-V1',
      ),
      adminApi<Array<{ id: string; code: string }>>(context, 'GET', '/admin/inventory/locations'),
    ]);
    const variantId = inventory.items.find(({ sku }) => sku === 'E2E-PUFFJET-MINT-V1')?.id;
    const locationId = locations.find(({ code }) => code === 'E2E-FULFILLMENT')?.id;
    expect(variantId).toBeTruthy();
    expect(locationId).toBeTruthy();
    const receiptBody = {
      variantId,
      locationId,
      batchNumber: 'E2E-BATCH-RECEIPT',
      supplierReference: 'PLAYWRIGHT-RECEIPT-001',
      manufacturedAt: '2026-01-01',
      expiryDate: '2030-12-31',
      quantity: 2,
      note: 'Real operational browser receipt',
    };
    const idempotencyKey = randomUUID();
    const received = await adminApi<{ quantityReceived: number; replayed: boolean }>(
      context,
      'POST',
      '/admin/inventory/batches/receipts',
      receiptBody,
      { 'Idempotency-Key': idempotencyKey },
    );
    expect(received).toMatchObject({ quantityReceived: 2, replayed: false });
    const replayed = await adminApi<{ quantityReceived: number; replayed: boolean }>(
      context,
      'POST',
      '/admin/inventory/batches/receipts',
      receiptBody,
      { 'Idempotency-Key': idempotencyKey },
    );
    expect(replayed).toMatchObject({ quantityReceived: 2, replayed: true });
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

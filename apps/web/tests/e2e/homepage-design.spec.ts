import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/storefront/status')) {
      await route.fulfill({
        json: {
          data: {
            storeName: 'PUFFJET',
            maintenanceMode: false,
            prelaunchMode: false,
            checkoutEnabled: false,
            minimumAge: 18,
            ageGateRequired: false,
            ageConfirmed: true,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/storefront/home')) {
      await route.fulfill({
        json: {
          data: {
            featured: [
              {
                id: 'product-1',
                name: 'Jet Menthe',
                slug: 'jet-menthe',
                shortDescription: 'Une référence publiée issue du catalogue.',
                brandName: 'Marque test',
                brandSlug: 'marque-test',
                productType: 'DISPOSABLE',
                flavor: 'Menthe fraîche',
                priceMillimes: 99_000,
                promotionalPriceMillimes: null,
                availableQuantity: 12,
                lowStock: false,
                ageRestricted: true,
                primaryImage: null,
              },
            ],
            categories: [{ id: 'category-1', name: 'Jetables', slug: 'jetables', productCount: 1 }],
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/catalog/facets')) {
      await route.fulfill({
        json: {
          data: {
            brands: [],
            productTypes: ['DISPOSABLE'],
            flavors: [
              {
                value: 'cool-mint',
                nameFr: 'Menthe fraîche',
                nameAr: 'نعناع بارد',
                productCount: 1,
              },
              {
                value: 'mixed-berries',
                nameFr: 'Fruits rouges',
                nameAr: 'توت مشكل',
                productCount: 1,
              },
              {
                value: 'grape-ice',
                nameFr: 'Raisin',
                nameAr: 'عنب',
                productCount: 1,
              },
              {
                value: 'citrus',
                nameFr: 'Agrumes',
                nameAr: 'حمضيات',
                productCount: 1,
              },
            ],
            puffCounts: [],
            nicotineStrengthsMg: [],
            priceRange: { minimumMillimes: 99_000, maximumMillimes: 99_000 },
            truncated: {
              brands: false,
              flavors: false,
              puffCounts: false,
              nicotineStrengths: false,
            },
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/cart/summary')) {
      await route.fulfill({ json: { data: { itemCount: 0 } } });
      return;
    }
    if (url.pathname.includes('/auth/customer/session')) {
      await route.fulfill({
        status: 401,
        json: { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
      return;
    }
    await route.fulfill({ json: { data: {} } });
  });
});

test('neon homepage is responsive, localized, and keeps checkout closed', async ({ page }) => {
  await page.goto('/');
  const mobileViewport = (page.viewportSize()?.width ?? 1280) < 1024;

  await expect(
    page.getByRole('heading', {
      name: 'Le futur du puff jetable, rapide et premium en Tunisie.',
    }),
  ).toBeVisible();
  await expect(page.locator('.jet-device')).toBeVisible();
  await expect(page.getByRole('link', { name: /Menthe fraîche/ })).toBeVisible();
  await expect(page.locator('a[href="/checkout"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  if (mobileViewport) {
    await page.getByRole('button', { name: 'Ouvrir le menu principal' }).click();
    await expect(page.getByRole('link', { name: 'Puffs' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('homepage has no horizontal overflow at the supported breakpoints', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One browser project covers the breakpoint matrix.',
  );

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1448, height: 1086 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.neon-hero')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
});

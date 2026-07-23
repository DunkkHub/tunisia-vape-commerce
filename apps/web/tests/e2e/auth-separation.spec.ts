import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/storefront/status')) {
      await route.fulfill({
        json: {
          data: {
            storeName: 'Boutique vérifiée',
            maintenanceMode: false,
            prelaunchMode: false,
            checkoutEnabled: true,
            minimumAge: 18,
            ageGateRequired: false,
            ageConfirmed: true,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/cart/summary')) {
      await route.fulfill({ json: { data: { itemCount: 0 } } });
      return;
    }
    if (url.pathname.includes('/auth/') && url.pathname.endsWith('/session')) {
      await route.fulfill({
        status: 401,
        json: { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
      return;
    }
    await route.fulfill({ json: { data: {} } });
  });
});

test('customer and staff logins have separate routes and visual contexts', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion client' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Panier' })).toBeVisible();

  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Accès administration' })).toBeVisible();
  await expect(page.getByText('Zone à accès restreint')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Panier' })).toHaveCount(0);
});

test('protected admin routes redirect only to the staff login', async ({ page }) => {
  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { name: 'Accès administration' })).toBeVisible();
});

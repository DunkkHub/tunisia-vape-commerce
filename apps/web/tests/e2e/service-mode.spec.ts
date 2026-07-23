import { expect, test } from '@playwright/test';

test('prelaunch page stays readable without clipping at compact viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One browser project covers the viewport matrix.',
  );

  const requestedPaths: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    requestedPaths.push(url.pathname);

    if (url.pathname.endsWith('/storefront/status')) {
      await route.fulfill({
        json: {
          data: {
            storeName: '',
            maintenanceMode: false,
            prelaunchMode: true,
            checkoutEnabled: false,
            minimumAge: 0,
            ageGateRequired: false,
            ageConfirmed: false,
          },
        },
      });
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

  for (const viewport of [
    { width: 744, height: 629 },
    { width: 320, height: 480 },
    { width: 667, height: 375 },
    { width: 1024, height: 500 },
    { width: 667, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Une boutique tunisienne pensée avec exigence.' }),
    ).toBeVisible();

    const geometry = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.service-mode__content');
      const footer = document.querySelector<HTMLElement>('.service-mode > small');
      if (!content || !footer) throw new Error('Expected service-mode geometry was not rendered.');

      const contentBox = content.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        contentLeft: contentBox.left,
        contentRight: contentBox.right,
        contentBottom: contentBox.bottom,
        footerTop: footerBox.top,
      };
    });

    expect(geometry.noHorizontalOverflow).toBe(true);
    expect(geometry.contentLeft).toBeGreaterThanOrEqual(-1);
    expect(geometry.contentRight).toBeLessThanOrEqual(viewport.width + 1);
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
  }

  expect(requestedPaths.some((path) => path.endsWith('/storefront/home'))).toBe(false);
  expect(requestedPaths.some((path) => path.endsWith('/catalog/facets'))).toBe(false);
  expect(requestedPaths.some((path) => path.endsWith('/cart/summary'))).toBe(false);
});

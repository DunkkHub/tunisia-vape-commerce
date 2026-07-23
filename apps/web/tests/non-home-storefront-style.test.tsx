/// <reference types="node" />

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

import { changeLocale } from '../src/i18n';
import {
  installDefaultFetch,
  json,
  renderRoute,
  requestUrl,
  statusPayload,
  unauthorized,
} from './test-app';

const storefrontStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

function installHomeFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/storefront/status'))
        return Promise.resolve(json({ ...statusPayload, storeName: 'PUFFJET' }));
      if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
      if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
      if (url.includes('/storefront/home'))
        return Promise.resolve(json({ featured: [], categories: [] }));
      if (url.includes('/catalog/facets'))
        return Promise.resolve(
          json({
            brands: [],
            productTypes: [],
            flavors: [],
            priceRange: { minimumMillimes: null, maximumMillimes: null },
            truncated: { brands: false, flavors: false },
          }),
        );
      return Promise.resolve(json({}));
    }),
  );
}

it('applies the accessible neon interior system while preserving the home scope', async () => {
  installDefaultFetch();
  const loginRender = renderRoute('/login');
  const heading = await screen.findByRole('heading', { name: 'Connexion client' });
  const shell = loginRender.container.querySelector('.store-shell');
  expect(shell).toHaveClass('store-shell--interior');
  expect(shell).not.toHaveClass('store-shell--home');
  expect(screen.getByRole('link', { name: 'Aller au contenu principal' })).toHaveAttribute(
    'href',
    '#main-content',
  );

  expect(heading.tagName).toBe('H1');
  expect(storefrontStyles).toMatch(
    /\.store-shell--interior\s*\{[^}]*--store-bg:\s*#03050b;[^}]*--store-primary:\s*#ce82ff;[^}]*color-scheme:\s*dark;/s,
  );
  expect(storefrontStyles).toMatch(/\.store-shell--interior h1,[^{]+\{[^}]*font-family:\s*Inter,/s);
  expect(storefrontStyles).toMatch(
    /\.store-shell--interior \.field input,[^{]+\{[^}]*min-height:\s*48px;/s,
  );
  expect(storefrontStyles).toContain('@media (max-width: 479px)');
  expect(storefrontStyles).toContain('@media (min-width: 768px)');
  expect(storefrontStyles).toContain('@media (min-width: 1024px)');
  expect(storefrontStyles).toContain('@media (min-width: 1440px)');
  expect(storefrontStyles).toContain('@media (prefers-reduced-motion: reduce)');

  loginRender.unmount();
  installHomeFetch();
  const homeRender = renderRoute('/');
  await screen.findByRole('heading', {
    name: 'Le futur du puff jetable, rapide et premium en Tunisie.',
  });
  const homeShell = homeRender.container.querySelector('.store-shell');
  expect(homeShell).toHaveClass('store-shell--home');
  expect(homeShell).not.toHaveClass('store-shell--interior');
});

it('keeps the interior navigation operable and logically directed in Arabic', async () => {
  await changeLocale('ar');
  installDefaultFetch();
  const user = userEvent.setup();
  const { container } = renderRoute('/login');

  expect(await screen.findByRole('heading', { name: 'دخول الحريف' })).toBeVisible();
  expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  expect(container.querySelector('.store-shell')).toHaveClass('store-shell--interior');
  expect(screen.getByRole('link', { name: 'الانتقال إلى المحتوى الرئيسي' })).toHaveAttribute(
    'href',
    '#main-content',
  );

  const menuButton = screen.getByRole('button', { name: 'فتح القائمة الرئيسية' });
  expect(storefrontStyles).toMatch(
    /\.store-shell--interior \.icon-link,[^{]+\.store-shell--interior \.menu-toggle\s*\{[^}]*width:\s*46px;[^}]*height:\s*46px;/s,
  );
  await user.click(menuButton);
  expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  expect(container.querySelector('#mobile-menu')).toBeVisible();
});

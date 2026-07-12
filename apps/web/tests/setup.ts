import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import i18n from '../src/i18n';

afterEach(() => cleanup());

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  document.cookie = 'store_locale=fr; Path=/';
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

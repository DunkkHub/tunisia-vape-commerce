import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import i18n from '../src/i18n';
import { AdminSettingsPage } from '../src/pages/admin/admin-settings-page';
import { json, requestUrl } from './test-app';

const settings = [
  {
    id: 'store:store-1',
    sourceId: 'store-1',
    scope: 'STORE',
    key: 'store.name',
    valueType: 'STRING',
    value: 'PUFFJET',
    redacted: false,
    description: 'Store name.',
    legallyReviewed: null,
    reviewedAt: null,
    version: 2,
    updatedAt: '2026-07-20T10:00:00.000Z',
  },
  {
    id: 'compliance:compliance-1',
    sourceId: 'compliance-1',
    scope: 'COMPLIANCE',
    key: 'identity_document_images.enabled',
    valueType: 'BOOLEAN',
    value: false,
    redacted: false,
    description: 'Read-only unsupported setting.',
    legallyReviewed: false,
    reviewedAt: null,
    version: 1,
    updatedAt: '2026-07-20T10:00:00.000Z',
  },
] as const;

const exportedConfiguration = {
  format: 'tunisia-vape-store-configuration',
  schemaVersion: 1,
  store: [{ key: 'store.name', valueType: 'STRING', value: 'PUFFJET' }],
  compliance: [],
  excludedSecretCount: 0,
  checksumSha256: 'a'.repeat(64),
};

describe('administrator settings transfer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
    document.cookie = 'vape_admin_csrf=test-csrf; Path=/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps unsupported rows read-only and downloads the protected secret-free export', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/settings?')) {
        return Promise.resolve(
          json({ items: settings, page: 1, pageSize: 50, total: 2, totalPages: 1 }),
        );
      }
      if (url.endsWith('/admin/settings/export') && init?.method === 'POST') {
        return Promise.resolve(json(exportedConfiguration));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const createObjectUrl = vi.fn(() => 'blob:store-configuration');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'store.name' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'identity_document_images.enabled' })).toBeVisible();
    const saveButtons = screen.getAllByRole('button', { name: 'Enregistrer' });
    expect(saveButtons[0]).toBeEnabled();
    expect(saveButtons[1]).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Exporter sans secrets' }));

    expect(
      await screen.findByText('Le fichier de configuration sans secrets a été téléchargé.'),
    ).toBeVisible();
    const exportCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith('/admin/settings/export'),
    );
    expect(exportCall?.[1]?.method).toBe('POST');
    expect(new Headers(exportCall?.[1]?.headers).get('X-CSRF-Token')).toBe('test-csrf');
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob)));
    expect(downloadClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:store-configuration');
  });
});

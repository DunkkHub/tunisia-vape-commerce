import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import type { AdminSettingRecord } from '../src/api/types';
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
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    await user.click(screen.getByRole('tab', { name: /^Système/ }));
    expect(screen.getByRole('heading', { name: 'identity_document_images.enabled' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

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

  it('saves a changed value and confirms the result beside the setting form', async () => {
    let currentSetting: AdminSettingRecord = { ...settings[0] };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/settings?')) {
        return Promise.resolve(
          json({ items: [currentSetting], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      if (url.endsWith('/admin/settings/store/store.name') && init?.method === 'PATCH') {
        currentSetting = {
          ...currentSetting,
          value: 'PUFFJET Bizerte',
          version: currentSetting.version + 1,
        };
        return Promise.resolve(json(currentSetting));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    const form = (await screen.findByRole('heading', { name: 'store.name' })).closest('form');
    expect(form).not.toBeNull();
    const fields = within(form!);
    await user.clear(fields.getByLabelText('Valeur'));
    await user.type(fields.getByLabelText('Valeur'), 'PUFFJET Bizerte');
    await user.type(fields.getByLabelText('Motif obligatoire de la modification'), 'Identité');
    await user.click(fields.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/settings/store/store.name') &&
          init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const requestBody = patch?.[1]?.body;
      expect(typeof requestBody).toBe('string');
      if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body.');
      expect(JSON.parse(requestBody)).toEqual({
        value: 'PUFFJET Bizerte',
        expectedVersion: 2,
        reason: 'Identité',
        confirmed: true,
      });
      expect(new Headers(patch?.[1]?.headers).get('X-CSRF-Token')).toBe('test-csrf');
    });
    expect(await screen.findByDisplayValue('PUFFJET Bizerte')).toBeVisible();
    const savedForm = screen.getByRole('heading', { name: 'store.name' }).closest('form');
    const savedFields = within(savedForm!);
    expect(
      savedFields.getByText('Modification enregistrée. La valeur affichée est maintenant à jour.'),
    ).toBeVisible();
    expect(savedFields.getByLabelText('Motif obligatoire de la modification')).toHaveValue('');
    expect(screen.queryByText('Nous rencontrons un problème')).not.toBeInTheDocument();
  });

  it('does not send an unchanged value and explains that no save is needed', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      void _init;
      const url = requestUrl(input);
      if (url.includes('/admin/settings?')) {
        return Promise.resolve(
          json({ items: [settings[0]], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    const form = (await screen.findByRole('heading', { name: 'store.name' })).closest('form');
    const fields = within(form!);
    await user.type(fields.getByLabelText('Motif obligatoire de la modification'), 'Vérification');
    await user.click(fields.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await fields.findByText(
        'Cette valeur est déjà active. Aucune modification n’était nécessaire.',
      ),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).includes('/admin/settings/store/') && init?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('shows recent-authentication recovery and the safe request reference beside the field', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/settings?')) {
        return Promise.resolve(
          json({ items: [settings[0]], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      if (url.endsWith('/admin/settings/store/store.name') && init?.method === 'PATCH') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 403,
              code: 'RECENT_AUTHENTICATION_REQUIRED',
              message: 'Please authenticate again before performing this sensitive action.',
              requestId: 'settings-request-123',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    const form = (await screen.findByRole('heading', { name: 'store.name' })).closest('form');
    const fields = within(form!);
    await user.clear(fields.getByLabelText('Valeur'));
    await user.type(fields.getByLabelText('Valeur'), 'PUFFJET Tunis');
    await user.type(fields.getByLabelText('Motif obligatoire de la modification'), 'Identité');
    await user.click(fields.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await fields.findByText(/cette action exige une authentification récente/i),
    ).toBeVisible();
    expect(fields.getByText('Référence de la demande : settings-request-123')).toBeVisible();
    expect(screen.queryByText('Nous rencontrons un problème')).not.toBeInTheDocument();
  });

  it('keeps a conflicting edit visible until an explicit refresh loads the authoritative version', async () => {
    let loadAuthoritativeVersion = false;
    const authoritativeSetting: AdminSettingRecord = {
      ...settings[0],
      value: 'PUFFJET Centre',
      version: 3,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/settings?')) {
        const item = loadAuthoritativeVersion ? authoritativeSetting : settings[0];
        return Promise.resolve(
          json({ items: [item], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      if (url.endsWith('/admin/settings/store/store.name') && init?.method === 'PATCH') {
        loadAuthoritativeVersion = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 409,
              code: 'VERSION_CONFLICT',
              message: 'The setting changed since it was loaded. Reload it and retry.',
              requestId: 'settings-conflict-123',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    const form = (await screen.findByRole('heading', { name: 'store.name' })).closest('form');
    const fields = within(form!);
    await user.clear(fields.getByLabelText('Valeur'));
    await user.type(fields.getByLabelText('Valeur'), 'PUFFJET Nord');
    await user.type(fields.getByLabelText('Motif obligatoire de la modification'), 'Identité');
    await user.click(fields.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await fields.findByText(/Ce paramètre a été modifié depuis son chargement/i),
    ).toBeVisible();
    expect(fields.getByLabelText('Valeur')).toHaveValue('PUFFJET Nord');
    expect(fields.getByLabelText('Motif obligatoire de la modification')).toHaveValue('Identité');

    await user.click(screen.getByRole('button', { name: 'Actualiser' }));

    expect(await screen.findByDisplayValue('PUFFJET Centre')).toBeVisible();
    const refreshedForm = screen.getByRole('heading', { name: 'store.name' }).closest('form');
    expect(
      within(refreshedForm!).getByLabelText('Motif obligatoire de la modification'),
    ).toHaveValue('');
    expect(
      screen.queryByText('Référence de la demande : settings-conflict-123'),
    ).not.toBeInTheDocument();
  });

  it('marks already-correct fixed operational values as read-only', async () => {
    const timezone = {
      ...settings[0],
      id: 'store:timezone',
      sourceId: 'timezone',
      key: 'store.timezone',
      value: 'Africa/Tunis',
      description: 'Presentation timezone.',
      version: 1,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json({ items: [timezone], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        ),
      ),
    );

    render(
      <AppProviders>
        <AdminSettingsPage />
      </AppProviders>,
    );

    const form = (await screen.findByRole('heading', { name: 'store.timezone' })).closest('form');
    const fields = within(form!);
    expect(
      fields.getByText('Valeur opérationnelle fixe déjà configurée : Africa/Tunis.'),
    ).toBeVisible();
    expect(fields.getByLabelText('Valeur')).toBeDisabled();
    expect(fields.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });
});

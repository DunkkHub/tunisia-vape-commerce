import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl } from './test-app';

const superAdministrator = {
  id: 'super-1',
  email: 'super@example.test',
  name: 'Responsable principal',
  roles: ['Super Administrator'],
  permissions: ['customers.read', 'system.manage'],
};

const administratorAccount = {
  id: 'admin-2',
  email: 'ops@example.test',
  displayName: 'Responsable opérations',
  employeeCode: 'OPS-2',
  jobTitle: 'Opérations',
  status: 'ACTIVE',
  roles: [{ key: 'administrator', name: 'Administrator' }],
  twoFactorEnrolled: true,
  suspendedAt: null,
  suspensionReason: null,
  userVersion: 1,
  profileVersion: 1,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:00:00.000Z',
};

const customerAccount = {
  id: 'customer-profile-1',
  userId: 'customer-user-1',
  fullName: 'Cliente Test',
  normalizedPhone: '+21620111222',
  email: 'customer@example.test',
  status: 'ACTIVE',
  suspendedAt: null,
  suspensionReason: null,
  userVersion: 2,
  profileVersion: 3,
  createdAt: '2026-07-11T10:00:00.000Z',
};

function installAdminFetch(user: typeof superAdministrator) {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user }));
    if (url.includes('/admin/access/admins?')) {
      return Promise.resolve(
        json({ items: [administratorAccount], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
      );
    }
    if (url.includes('/admin/customers?')) {
      return Promise.resolve(
        json({ items: [customerAccount], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
      );
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('separated administrator and customer account management', () => {
  beforeEach(() => {
    document.documentElement.lang = 'fr';
  });

  it('shows the separate administrator destination and creation controls to a super administrator', async () => {
    installAdminFetch(superAdministrator);

    renderRoute('/admin/admins');

    expect(await screen.findByRole('heading', { level: 1, name: 'Administrateurs' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Administrateurs' })).toHaveAttribute(
      'href',
      '/admin/admins',
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      '/admin/customers',
    );
    expect(screen.getByRole('heading', { name: 'Créer un administrateur' })).toBeVisible();
    expect(await screen.findByText('Responsable opérations')).toBeVisible();
    expect(screen.queryByText('Cliente Test')).not.toBeInTheDocument();
  });

  it('keeps customer records on their own route', async () => {
    installAdminFetch(superAdministrator);

    renderRoute('/admin/customers');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    expect(await screen.findByText('Cliente Test')).toBeVisible();
    expect(screen.queryByText('Responsable opérations')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Créer un administrateur' }),
    ).not.toBeInTheDocument();
  });

  it('hides super-administrator navigation and controls from an ordinary administrator', async () => {
    const fetchMock = installAdminFetch({
      ...superAdministrator,
      id: 'admin-ordinary',
      roles: ['Administrator'],
      permissions: ['customers.read'],
    });

    renderRoute('/admin/admins');

    expect(
      await screen.findByText('Votre rôle ne permet pas d’accéder à cette section.'),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Administrateurs' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Créer un administrateur' }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/admin/access/admins?')),
    ).toBe(false);
  });
});

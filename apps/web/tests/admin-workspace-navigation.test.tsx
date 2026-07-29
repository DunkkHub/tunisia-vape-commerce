import { Boxes, Settings } from 'lucide-react';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  AdminDisclosure,
  AdminWorkspaceNav,
  AdminWorkspacePanel,
  type AdminWorkspaceItem,
} from '../src/components/admin/admin-workspace';

type Workspace = 'stock' | 'settings';

const items: AdminWorkspaceItem<Workspace>[] = [
  { id: 'stock', label: 'Stock', description: 'Lots et quantités', icon: Boxes },
  { id: 'settings', label: 'Réglages', description: 'Configuration avancée', icon: Settings },
];

function WorkspaceExample() {
  const [workspace, setWorkspace] = useState<Workspace>('stock');
  return (
    <>
      <AdminWorkspaceNav
        label="Espaces de test"
        value={workspace}
        items={items}
        onChange={setWorkspace}
      />
      <AdminWorkspacePanel id="stock" value={workspace}>
        <p>Contenu stock</p>
      </AdminWorkspacePanel>
      <AdminWorkspacePanel id="settings" value={workspace}>
        <p>Contenu réglages</p>
      </AdminWorkspacePanel>
    </>
  );
}

describe('shared administrator workspaces', () => {
  it('exposes one selected task and keeps every panel mounted while hiding inactive work', async () => {
    const user = userEvent.setup();
    render(<WorkspaceExample />);

    expect(screen.getByRole('tab', { name: /^Stock/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenu stock')).toBeVisible();
    expect(screen.getByText('Contenu réglages')).not.toBeVisible();

    screen.getByRole('tab', { name: /^Stock/ }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /^Réglages/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenu réglages')).toBeVisible();
    expect(screen.getByText('Contenu stock')).not.toBeVisible();
  });

  it('keeps advanced content behind a native, keyboard-operable disclosure', async () => {
    const user = userEvent.setup();
    render(
      <AdminDisclosure title="Outils avancés" description="Opérations occasionnelles">
        <button type="button">Action protégée</button>
      </AdminDisclosure>,
    );

    const heading = screen.getByRole('heading', { name: 'Outils avancés' });
    expect(screen.getByRole('button', { name: 'Action protégée' })).not.toBeVisible();

    await user.click(heading);

    expect(screen.getByRole('button', { name: 'Action protégée' })).toBeVisible();
  });
});

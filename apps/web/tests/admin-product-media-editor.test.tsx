import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import { AdminProductMediaEditor } from '../src/pages/admin/admin-product-media-editor';
import type * as MediaEditorUtils from '../src/pages/admin/product-media-editor-utils';

const processMediaFile = vi.hoisted(() => vi.fn());

vi.mock('../src/pages/admin/product-media-editor-utils', async (importOriginal) => {
  const original = await importOriginal<typeof MediaEditorUtils>();
  return { ...original, processMediaFile };
});

describe('administrator product media editor', () => {
  beforeEach(() => {
    processMediaFile.mockReset();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('blob:media-editor-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('prepares an edited copy and can restore the untouched session original', async () => {
    const original = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'front.jpg', {
      type: 'image/jpeg',
    });
    const edited = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'front-edited.webp', {
      type: 'image/webp',
    });
    processMediaFile.mockResolvedValue(edited);
    const onOutput = vi.fn();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminProductMediaEditor file={original} idPrefix="editor-test" onOutput={onOutput} />
      </AppProviders>,
    );

    expect(await screen.findByText('Original intact')).toBeVisible();
    await user.click(screen.getByText('Recadrer, pivoter, redimensionner ou compresser'));
    await user.click(screen.getByRole('button', { name: 'Pivoter à droite' }));

    await waitFor(() => expect(processMediaFile).toHaveBeenCalledTimes(1));
    const settings = processMediaFile.mock.calls[0]?.[1] as MediaEditorUtils.MediaEditSettings;
    expect(settings.rotation).toBe(90);
    await waitFor(() => expect(onOutput).toHaveBeenLastCalledWith(edited, 'edited'));
    expect(await screen.findByText('Copie modifiée prête')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Restaurer l’original' }));
    await waitFor(() => expect(onOutput).toHaveBeenLastCalledWith(original, 'original'));
    expect(await screen.findByText('Original intact')).toBeVisible();
  });
});

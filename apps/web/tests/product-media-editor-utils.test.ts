import { describe, expect, it } from 'vitest';

import {
  calculateMediaCrop,
  calculateMediaOutputDimensions,
  editedMediaFilename,
  mediaEditSettingsAreOriginal,
  DEFAULT_MEDIA_EDIT_SETTINGS,
} from '../src/pages/admin/product-media-editor-utils';

describe('product media editor calculations', () => {
  it('keeps the original session untouched until an explicit edit is made', () => {
    expect(mediaEditSettingsAreOriginal(DEFAULT_MEDIA_EDIT_SETTINGS)).toBe(true);
    expect(mediaEditSettingsAreOriginal({ ...DEFAULT_MEDIA_EDIT_SETTINGS, rotation: 90 })).toBe(
      false,
    );
  });

  it('crops around the requested focus without exceeding the source image', () => {
    expect(calculateMediaCrop(1600, 900, '1:1', 0, 50)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 900,
    });
    expect(calculateMediaCrop(1600, 900, '1:1', 100, 50)).toEqual({
      x: 700,
      y: 0,
      width: 900,
      height: 900,
    });
  });

  it('applies rotation and downscaling without ever upscaling', () => {
    expect(calculateMediaOutputDimensions({ width: 1200, height: 800 }, 90, 600, 900)).toEqual({
      width: 600,
      height: 900,
    });
    expect(calculateMediaOutputDimensions({ width: 400, height: 300 }, 0, 1200, 900)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('uses a safe extension for the selected browser output format', () => {
    expect(editedMediaFilename('catalogue.face.avif', 'image/webp')).toBe(
      'catalogue.face-edited.webp',
    );
    expect(editedMediaFilename('image', 'image/jpeg')).toBe('image-edited.jpg');
  });
});

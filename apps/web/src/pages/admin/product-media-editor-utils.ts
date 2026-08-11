export type MediaCropAspect = 'original' | '1:1' | '4:5' | '16:9';

export type MediaOutputType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface MediaEditSettings {
  cropAspect: MediaCropAspect;
  focusX: number;
  focusY: number;
  rotation: 0 | 90 | 180 | 270;
  maxWidth: number | null;
  maxHeight: number | null;
  quality: number;
  outputType: MediaOutputType;
}

export interface MediaCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaOutputDimensions {
  width: number;
  height: number;
}

export const DEFAULT_MEDIA_EDIT_SETTINGS: MediaEditSettings = {
  cropAspect: 'original',
  focusX: 50,
  focusY: 50,
  rotation: 0,
  maxWidth: null,
  maxHeight: null,
  quality: 84,
  outputType: 'image/webp',
};

const aspectRatio = (aspect: MediaCropAspect): number | null => {
  if (aspect === '1:1') return 1;
  if (aspect === '4:5') return 4 / 5;
  if (aspect === '16:9') return 16 / 9;
  return null;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const mediaEditSettingsAreOriginal = (settings: MediaEditSettings): boolean =>
  settings.cropAspect === DEFAULT_MEDIA_EDIT_SETTINGS.cropAspect &&
  settings.focusX === DEFAULT_MEDIA_EDIT_SETTINGS.focusX &&
  settings.focusY === DEFAULT_MEDIA_EDIT_SETTINGS.focusY &&
  settings.rotation === DEFAULT_MEDIA_EDIT_SETTINGS.rotation &&
  settings.maxWidth === DEFAULT_MEDIA_EDIT_SETTINGS.maxWidth &&
  settings.maxHeight === DEFAULT_MEDIA_EDIT_SETTINGS.maxHeight &&
  settings.quality === DEFAULT_MEDIA_EDIT_SETTINGS.quality &&
  settings.outputType === DEFAULT_MEDIA_EDIT_SETTINGS.outputType;

export const calculateMediaCrop = (
  sourceWidth: number,
  sourceHeight: number,
  aspect: MediaCropAspect,
  focusX: number,
  focusY: number,
): MediaCropRect => {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const targetRatio = aspectRatio(aspect);
  if (targetRatio === null) return { x: 0, y: 0, width, height };

  const sourceRatio = width / height;
  if (sourceRatio > targetRatio) {
    const cropWidth = height * targetRatio;
    return {
      x: (width - cropWidth) * clamp(focusX / 100, 0, 1),
      y: 0,
      width: cropWidth,
      height,
    };
  }

  const cropHeight = width / targetRatio;
  return {
    x: 0,
    y: (height - cropHeight) * clamp(focusY / 100, 0, 1),
    width,
    height: cropHeight,
  };
};

export const calculateMediaOutputDimensions = (
  crop: Pick<MediaCropRect, 'width' | 'height'>,
  rotation: MediaEditSettings['rotation'],
  maxWidth: number | null,
  maxHeight: number | null,
): MediaOutputDimensions => {
  const rotatedWidth = rotation === 90 || rotation === 270 ? crop.height : crop.width;
  const rotatedHeight = rotation === 90 || rotation === 270 ? crop.width : crop.height;
  const widthScale = maxWidth && maxWidth > 0 ? maxWidth / rotatedWidth : 1;
  const heightScale = maxHeight && maxHeight > 0 ? maxHeight / rotatedHeight : 1;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    width: Math.max(1, Math.round(rotatedWidth * scale)),
    height: Math.max(1, Math.round(rotatedHeight * scale)),
  };
};

type DecodedMedia = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

const decodeWithImageElement = (file: File): Promise<DecodedMedia> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('MEDIA_EDITOR_DECODE_FAILED'));
        return;
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => URL.revokeObjectURL(objectUrl),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('MEDIA_EDITOR_DECODE_FAILED'));
    };
    image.src = objectUrl;
  });

const decodeMedia = async (file: File): Promise<DecodedMedia> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        bitmap.close();
        throw new Error('MEDIA_EDITOR_DECODE_FAILED');
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Older browsers can expose createImageBitmap without supporting this input.
    }
  }
  return decodeWithImageElement(file);
};

const canvasBlob = (
  canvas: HTMLCanvasElement,
  outputType: MediaOutputType,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('MEDIA_EDITOR_ENCODE_FAILED'))),
      outputType,
      clamp(quality, 40, 100) / 100,
    );
  });

const extensionForType: Record<MediaOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const editedMediaFilename = (filename: string, outputType: MediaOutputType): string => {
  const base = filename.replace(/\.[^.]+$/u, '') || 'image';
  return `${base}-edited.${extensionForType[outputType]}`;
};

export const processMediaFile = async (file: File, settings: MediaEditSettings): Promise<File> => {
  if (mediaEditSettingsAreOriginal(settings)) return file;

  const decoded = await decodeMedia(file);
  try {
    const crop = calculateMediaCrop(
      decoded.width,
      decoded.height,
      settings.cropAspect,
      settings.focusX,
      settings.focusY,
    );
    const output = calculateMediaOutputDimensions(
      crop,
      settings.rotation,
      settings.maxWidth,
      settings.maxHeight,
    );
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('MEDIA_EDITOR_CANVAS_UNAVAILABLE');

    if (settings.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, output.width, output.height);
    }

    const scale =
      settings.rotation === 90 || settings.rotation === 270
        ? output.height / crop.width
        : output.width / crop.width;
    context.save();
    context.translate(output.width / 2, output.height / 2);
    context.rotate((settings.rotation * Math.PI) / 180);
    context.drawImage(
      decoded.source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -(crop.width * scale) / 2,
      -(crop.height * scale) / 2,
      crop.width * scale,
      crop.height * scale,
    );
    context.restore();

    const blob = await canvasBlob(canvas, settings.outputType, settings.quality);
    return new File([blob], editedMediaFilename(file.name, settings.outputType), {
      type: settings.outputType,
      lastModified: Date.now(),
    });
  } finally {
    decoded.dispose();
  }
};

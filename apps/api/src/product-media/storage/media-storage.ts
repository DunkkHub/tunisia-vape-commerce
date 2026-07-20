export interface StoreMediaObjectInput {
  objectKey: string;
  contentType: string;
  checksumSha256: string;
  bytes: Buffer;
}

export interface MediaStorage {
  readonly bucket: string;
  put(input: StoreMediaObjectInput): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
}

export const PRODUCT_MEDIA_STORAGE = Symbol('PRODUCT_MEDIA_STORAGE');

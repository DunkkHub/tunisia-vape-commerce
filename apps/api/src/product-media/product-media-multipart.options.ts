import type { ConfigService } from '@nestjs/config';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import type { Environment } from '../config/environment';

export const productMediaMulterOptions = (
  config: ConfigService<Environment, true>,
): MulterModuleOptions => ({
  limits: {
    fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }),
    files: 1,
    fields: 5,
    // Busboy's parts-limit notification is boundary-sensitive at the exact
    // file-plus-fields count. Keep the explicit file/field caps authoritative
    // and allow one boundary slot beyond the six valid upload parts.
    parts: 7,
    fieldNameSize: 100,
    fieldSize: 4 * 1_024,
  },
});

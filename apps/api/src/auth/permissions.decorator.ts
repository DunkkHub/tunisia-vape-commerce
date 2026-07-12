import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_METADATA = 'required-permissions';
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_METADATA, permissions);

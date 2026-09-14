import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions.constant';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for a resolver/route
 * @param permissions - Array of permissions required
 *
 * @example
 * @RequirePermissions('view:course', 'edit:course')
 * async updateCourse() { ... }
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Alias for RequirePermissions with string array
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
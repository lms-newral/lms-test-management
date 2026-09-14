import {
  CanActivate,
  ExecutionContext,
  Logger,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorators';
import {
  AuthenticatedUser,
  GraphQLContext,
} from '../interfaces/auth.interface';
import {
  hasAllPermissions,
  Permission,
} from '../constants/permissions.constant';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Permissions logic to be implemented
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    const ctx = GqlExecutionContext.create(context);
    const gqlCtx = ctx.getContext<GraphQLContext>();
    const { user } = gqlCtx.req as { user: AuthenticatedUser };

    if (!user) {
      this.logger.warn('[PermissionsGuard] No user found in request');
      throw new ForbiddenException('Authentication required');
    }

    const hasPermission = hasAllPermissions(user.role, requiredPermissions);

    if (!hasPermission) {
      this.logger.warn(
        `[PermissionsGuard] User ${user.userId} (${user.role}) denied access. Missing permissions: ${requiredPermissions.join(', ')}`,
      );

      throw new ForbiddenException(
        `You do not have the required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    this.logger.log(`[PermissionsGuard] User ${user.userId} granted access`);

    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestWithUser } from '../interfaces/auth.interface';
import { SessionService } from 'src/modules/auth/session.service';

/**
 * Signs the caller in via the main backend -- see SessionService.
 *
 * Keeps the main backend's name, GqlAuthGuard, so the question-bank module
 * ported from there compiles unchanged. It is registered globally and also
 * applied by those resolvers; the second run returns early because req.user is
 * already set, so a request is only ever checked once.
 */
@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req =
      context.getType<string>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{
            req: RequestWithUser;
          }>().req
        : context.switchToHttp().getRequest<RequestWithUser>();

    if (req.user) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    try {
      req.user = await this.sessions.resolve(req);
      req.tenantId = req.user.tenantId;
      return true;
    } catch (err) {
      if (isPublic) return true;
      throw err;
    }
  }
}

import { createHash } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  AuthenticatedUser,
  JWTPayload,
  Role,
} from 'src/common/interfaces/auth.interface';

const ME_QUERY =
  'query SessionCheck { me { id email firstName lastName role tenantId } }';

/**
 * Request headers the main backend's own auth depends on, forwarded unchanged:
 * the cookie or bearer token, the tenant, and the origin/device headers its
 * domain-role and single-device checks read.
 */
const FORWARDED_HEADERS = [
  'cookie',
  'authorization',
  'x-tenant-subdomain',
  'origin',
  'referer',
  'x-device-id',
  'x-client-type',
  'user-agent',
];

interface MeResult {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  tenantId: string;
}

interface GraphQLResponse {
  data?: { me?: MeResult | null } | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

const header = (req: Request, name: string): string => {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
};

/**
 * Turns an incoming request into the signed-in user, using the main backend as
 * the authority.
 *
 * A valid signature is not enough. On every request the main backend also
 * rejects deactivated users, a tenant that does not match the subdomain, a role
 * used on the wrong domain, and a session replaced by a login on another device.
 * Checking only the JWT here would skip all four. So the token is verified
 * locally first (cheap, rejects garbage without a network call), then the main
 * backend's `me` query is asked with the caller's own headers, which runs every
 * one of those checks exactly as it would for the main API.
 *
 * The answer is cached for SESSION_CACHE_SECONDS (default 60), keyed on the
 * token plus the headers that change the outcome. A revoked session therefore
 * keeps working here for at most that long.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly cache = new Map<
    string,
    { user: AuthenticatedUser; expiresAt: number }
  >();
  private readonly mainApiUrl: string;
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.mainApiUrl = config.get<string>(
      'MAIN_API_URL',
      'http://localhost:3000/graphql',
    );
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
    this.secret = secret;
    const seconds = Number(config.get('SESSION_CACHE_SECONDS', 60));
    this.ttlMs =
      (Number.isFinite(seconds) && seconds >= 0 ? seconds : 60) * 1000;
  }

  async resolve(req: Request): Promise<AuthenticatedUser> {
    const subdomain = header(req, 'x-tenant-subdomain');
    const token = this.readToken(req, subdomain);
    if (!token) throw new UnauthorizedException('Not signed in');

    let payload: JWTPayload;
    try {
      payload = await this.jwt.verifyAsync<JWTPayload>(token, {
        secret: this.secret,
      });
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    const key = createHash('sha256')
      .update(
        [
          token,
          subdomain,
          header(req, 'origin'),
          header(req, 'x-device-id'),
        ].join('|'),
      )
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const user = await this.askMainBackend(req);
    if (user.userId !== payload.userId || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Session does not match this token');
    }

    if (this.cache.size > 10_000) this.pruneExpired();
    this.cache.set(key, { user, expiresAt: Date.now() + this.ttlMs });
    return user;
  }

  /** Same lookup order as the main backend: bearer, tenant cookie, generic cookie. */
  private readToken(req: Request, subdomain: string): string | undefined {
    const auth = header(req, 'authorization');
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    return (
      (subdomain ? cookies[`accessToken_${subdomain}`] : undefined) ??
      cookies['accessToken']
    );
  }

  /**
   * A user of the caller's own tenant, found by exact email through the main
   * backend (which owns users). The caller's headers are forwarded, so the main
   * backend scopes the search to their tenant. Null when there is no such user.
   */
  async findTenantUserByEmail(
    req: Request,
    email: string,
  ): Promise<{ id: string; email: string; name: string; role: string } | null> {
    const res = await fetch(this.mainApiUrl, {
      method: 'POST',
      headers: this.headersFor(req),
      body: JSON.stringify({
        query:
          'query FindTenantUser($s: String) { tenantUsers(search: $s, take: 10) { users { id email firstName lastName role } } }',
        variables: { s: email },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      throw new ServiceUnavailableException('Could not reach the main backend to look up students.');
    });
    const body = (await res.json()) as {
      data?: { tenantUsers?: { users: { id: string; email: string; firstName?: string | null; lastName?: string | null; role: string }[] } };
      errors?: { message: string }[];
    };
    if (body.errors?.length) throw new ServiceUnavailableException(body.errors[0].message);
    const u = body.data?.tenantUsers?.users.find(
      (x) => x.email.toLowerCase() === email.toLowerCase(),
    );
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      role: String(u.role).toLowerCase(),
    };
  }

  private headersFor(req: Request): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    for (const name of FORWARDED_HEADERS) {
      const value = header(req, name);
      if (value) headers[name] = value;
    }
    // So the main backend's rate limiter counts the real caller, not this
    // service, which would otherwise be one IP making every call.
    if (req.ip) headers['x-forwarded-for'] = req.ip;
    return headers;
  }

  private async askMainBackend(req: Request): Promise<AuthenticatedUser> {
    let body: GraphQLResponse;
    try {
      const res = await fetch(this.mainApiUrl, {
        method: 'POST',
        headers: this.headersFor(req),
        body: JSON.stringify({ query: ME_QUERY }),
        signal: AbortSignal.timeout(5000),
      });
      body = (await res.json()) as GraphQLResponse;
    } catch (err) {
      this.logger.error(
        `Main backend unreachable at ${this.mainApiUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Could not verify your session. Please try again.',
      );
    }

    const me = body.data?.me;
    if (!me) {
      const first = body.errors?.[0];
      if (first?.extensions?.code === 'FORBIDDEN') {
        throw new ForbiddenException(first.message);
      }
      throw new UnauthorizedException(first?.message ?? 'Not signed in');
    }

    // GraphQL sends the enum's name (ADMIN); the code compares its value (admin).
    const role = String(me.role).toLowerCase() as Role;
    if (!Object.values(Role).includes(role)) {
      throw new UnauthorizedException(`Unknown role: ${me.role}`);
    }

    return {
      userId: me.id,
      tenantId: me.tenantId,
      role,
      email: me.email,
      firstName: me.firstName ?? undefined,
      lastName: me.lastName ?? undefined,
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

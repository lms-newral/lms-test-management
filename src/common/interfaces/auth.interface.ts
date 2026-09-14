import { Request, Response } from 'express';

export enum Role {
  ADMIN = 'admin',
  TEACHER = 'teacher',
  STUDENT = 'student',
}

export interface TenantInfo {
  id: string;
  subdomain: string;
  companyName: string;
  logoUrl?: string | null;
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  } | null;
  status?: string;
  planType?: string;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
  firstName?: string;
  lastName?: string;
  tenant?: TenantInfo;
  activeDevices?: any;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
  tenantId?: string;
  tenant?: TenantInfo;
}

export interface GraphQLContext {
  req: RequestWithUser;
  res: Response;
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: Role;
}

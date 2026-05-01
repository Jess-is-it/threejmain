import { Request } from 'express';

export interface AuthUser {
  userId: string;
  username?: string;
  permissions: string[];
}

export interface RequestWithContext extends Request {
  correlationId?: string;
  user?: AuthUser;
}

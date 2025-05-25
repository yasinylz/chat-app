import { Elysia } from 'elysia';
import * as jwt from 'jsonwebtoken';
import * as Auth from '../controllers/auth.controller';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';

interface JwtPayload {
  id: string;
}

interface Context {
  cookie: { auth?: { value: string } };
  headers: { authorization?: string };
}

export const authMiddleware = (app: Elysia) =>
  app.derive(async ({ cookie, headers }: Context) => {
    const tokenFromHeader = headers.authorization?.replace('Bearer ', '');
    const tokenFromCookie = cookie.auth?.value;
    const token = tokenFromHeader || tokenFromCookie;
    if (!token) return { user: null };

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const user = await Auth.me(token);
      return { user };
    } catch {
      return { user: null };
    }
  });
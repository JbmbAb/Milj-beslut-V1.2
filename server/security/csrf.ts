import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

const CSRF_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-csrf-token' : 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * CSRF Middleware: Implementerar Double Submit Cookie-mönstret.
 *
 * 1. Sätter en säker CSRF-cookie om den inte finns.
 * 2. Validerar inkommande x-csrf-token header för muterande anrop (POST, PUT, DELETE, PATCH).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // 1. Läs befintlig token från cookie (bör vara smidigast om cookie-parser används)
  let cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  // Fallback manuell parsning om cookie-parser saknas
  if (!cookieToken && req.headers.cookie) {
    const match = req.headers.cookie.match(new RegExp(`(^| )${CSRF_COOKIE_NAME}=([^;]+)`));
    if (match) cookieToken = match[2];
  }

  // 2. Om ingen token finns (ex. första besöket), generera en ny
  if (!cookieToken) {
    cookieToken = crypto.randomBytes(32).toString('hex');

    res.cookie(CSRF_COOKIE_NAME, cookieToken, {
      httpOnly: true, // Frontend får ej läsa denna direkt. Hämtas istället via ett eget API
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  // Spara token i res.locals så vi kan returnera den säkert via en specifik endpoint
  res.locals.csrfToken = cookieToken;

  // 3. Släpp igenom läs-metoder utan validering
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 4. Verifiera CSRF-token för alla muterande anrop (POST, PUT, DELETE etc)
  const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers[CSRF_HEADER_NAME.toLowerCase()];

  // Undantag kan läggas till här (ex. om BankID-callbacks görs utifrån utan token)
  // if (req.path === '/api/auth/bankid/callback') return next();

  if (!headerToken || headerToken !== cookieToken) {
    return res.status(403).json({
      ok: false,
      error: 'Möjlig Cross-Site Request Forgery attack blockerad. Ogiltig eller saknad CSRF-token.',
    });
  }

  next();
}

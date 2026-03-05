import express from 'express';
import secureApiRouter from './secureApi.express';
import geminiRouter from './geminiApi.express';
import geminiDbRouter from './geminiDbApi.express';

export function createApp() {
  const app = express();

  const corsAllowList = String(process.env.CORS_ALLOW_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowAnyCorsOrigin = corsAllowList.includes('*');

  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    const allowOrigin = origin && (allowAnyCorsOrigin || corsAllowList.includes(origin));

    if (allowOrigin) {
      res.header('Access-Control-Allow-Origin', allowAnyCorsOrigin ? '*' : origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'riskguard-secure-backend' });
  });

  app.use(secureApiRouter);
  app.use(geminiRouter);
  app.use(geminiDbRouter);

  return app;
}


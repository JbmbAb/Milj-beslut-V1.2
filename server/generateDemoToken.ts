import { signJwt } from './security/auth';
import dotenv from 'dotenv';
dotenv.config();

const demoUser = {
    id: 'demo-user-id',
    organisationId: 'cmm4xvu980000cuh4vj0usz09', // From earlier DB check
    bankidId: 'demo-bankid',
    role: 'ADMIN' as const
};

const now = Math.floor(Date.now() / 1000);
const payload = {
    sub: demoUser.id,
    organisationId: demoUser.organisationId,
    bankidId: demoUser.bankidId,
    role: demoUser.role,
    type: 'access' as const,
    jti: 'demo-jti-' + now,
    iat: now,
    exp: now + (3600 * 24 * 365) // 1 year
};

const token = signJwt(payload as any, process.env.JWT_ACCESS_SECRET!);
console.log('DEMO_TOKEN:', token);

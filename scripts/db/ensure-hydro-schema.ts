import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS hydro;');
await prisma.$disconnect();
console.log('hydro schema ready');

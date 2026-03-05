import { PrismaClient } from "@prisma/client";

declare global {
  var __miljobeslutPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__miljobeslutPrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__miljobeslutPrisma = prisma;
}

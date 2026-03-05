import { PrismaClient } from "@prisma/client";

declare global {
  var __riskguardPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__riskguardPrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__riskguardPrisma = prisma;
}

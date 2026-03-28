import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const prismaClientSingleton = (): PrismaClient => {
  const dbUrl = process.env.DATABASE_URL || "";
  const isAccelerate = dbUrl.startsWith("prisma");

  if (isAccelerate) {
    // Prisma Accelerate uses a `prisma://` datasource URL.
    // We cast to `PrismaClient` to avoid union types leaking into the app when Accelerate is enabled.
    return (new PrismaClient({ log: ["warn", "error"], accelerateUrl: dbUrl } as any).$extends(
      withAccelerate(),
    ) as unknown) as PrismaClient;
  }

  // Lokal standard-anslutning (mer stabil för dev)
  return new PrismaClient({
    log: ["warn", "error"],
  });
};

declare global {
  var __miljobeslutPrisma: PrismaClient | undefined;
}

export const prisma = (globalThis.__miljobeslutPrisma ?? prismaClientSingleton()) as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalThis.__miljobeslutPrisma = prisma;
}

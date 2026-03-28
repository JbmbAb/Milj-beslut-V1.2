import { prisma } from "../server/db/prisma";

async function main() {
  const rows = await prisma.auditTrail.findMany({
    orderBy: { timestamp: "asc" },
    take: 5
  });
  console.log(JSON.stringify(rows, null, 2));
}

main();

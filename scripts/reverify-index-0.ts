import { prisma } from "../server/db/prisma";
import crypto from "node:crypto";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function main() {
  const row = await prisma.auditTrail.findFirst({
    orderBy: { timestamp: "asc" }
  });

  if (!row) {
    console.log("No audit rows found.");
    return;
  }

  const previous = "GENESIS";
  const tsStr = row.timestamp.toISOString();
  const input = `${previous}|${row.payloadHash}|${tsStr}`;
  const expected = sha256(input);

  console.log("Audit Row Index 0 Debug:");
  console.log("  ID:", row.id);
  console.log("  PayloadHash:", row.payloadHash);
  console.log("  Timestamp (ISO):", tsStr);
  console.log("  PrevHash in DB:", row.prevHash);
  console.log("  ChainHash in DB:", row.chainHash);
  console.log("  Recalculated Input:", input);
  console.log("  Recalculated Hash:", expected);
  
  if (expected === row.chainHash) {
    console.log("✅ Match!");
  } else {
    console.log("❌ Mismatch!");
  }
}

main();

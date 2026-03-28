import { verifyAuditTrail } from "../server/security/auditTrail";

async function main() {
  console.log("🔍 Startar verifiering av Audit Trail...");
  
  try {
    const result = await verifyAuditTrail();
    
    if (result.ok) {
      console.log("✅ Audit Trail-integritet bekräftad. Alla kedjehashar är giltiga.");
      process.exit(0);
    } else {
      console.error(`❌ INTEGRITETSFEL DETEKTERAT!`);
      console.error(`Ogiltig hash vid index: ${result.invalidIndex}`);
      console.error(`Detta kan tyda på att databasen har manipulerats manuellt.`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Fysiskt fel under verifiering:", error);
    process.exit(1);
  }
}

main();

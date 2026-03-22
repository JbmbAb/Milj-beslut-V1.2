import { cleanupExpiredTokenRevocations } from "../server/repositories/tokenRepository";
import { logger } from "../server/logger";

/**
 * Cleanup script for expired token revocations.
 * Should be run daily via cron to ensure GDPR compliance and DB hygiene.
 */
async function main() {
  logger.info("Starting cleanup of expired token revocations...");
  try {
    const deletedCount = await cleanupExpiredTokenRevocations();
    logger.info(`Cleanup finished. Deleted ${deletedCount} expired revocation records.`);
    process.exit(0);
  } catch (error) {
    logger.error("Cleanup failed:", error);
    process.exit(1);
  }
}

main();

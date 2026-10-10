/**
 * Read-only DatasetApproval authority activation probe.
 * Never issues Byggnaden approval. Never writes Master/CAS.
 */
import {
  probeDatasetApprovalAuthorityActivation,
  runIsolatedDatasetApprovalAuthorityDryRun,
} from "../src/DatasetApprovalAuthorityBindings";

async function main(): Promise<void> {
  const report = probeDatasetApprovalAuthorityActivation(process.env, { cwd: process.cwd() });
  process.stdout.write(`${JSON.stringify({ activation_probe: report }, null, 2)}\n`);
  const dry = await runIsolatedDatasetApprovalAuthorityDryRun({
    reviewerIdentityRef: {
      id: "human-identity-operational-reviewer-probe",
      content_hash: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    producerIdentityRef: {
      id: "harvest-agent-loke",
      content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
    },
  });
  process.stdout.write(`${JSON.stringify({ isolated_dry_run: dry }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

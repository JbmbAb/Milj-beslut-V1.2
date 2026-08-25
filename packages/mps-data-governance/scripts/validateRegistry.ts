import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { SourceRegistryArtifact } from '../src/SourceRegistry';

const REGISTRY_PATH = resolve(
  process.env.SOURCE_REGISTRY_ARTIFACT_PATH ?? resolve(import.meta.dirname, '../../../source-registry/national-registry.json'),
);

function validateRegistry() {
  console.log(`Laddar Source Registry från: ${REGISTRY_PATH}`);
  
  const fileContent = readFileSync(REGISTRY_PATH, 'utf-8');
  const registry: SourceRegistryArtifact[] = JSON.parse(fileContent);
  
  console.log(`Hittade ${registry.length} källor i registret.\n`);
  
  let validCount = 0;

  for (const entry of registry) {
    if (entry.artifact_type !== 'SOURCE_REGISTRY_ENTRY') {
      console.error(`❌ Ogiltig artefakttyp: ${entry.artifact_type} (förväntade SOURCE_REGISTRY_ENTRY)`);
      continue;
    }
    if (!entry.source_id || !entry.producer || !entry.channel) {
      console.error(`❌ Saknar source_id/producer/channel för ${entry.artifact_id}`);
      continue;
    }
    if (entry.channel.channel_type !== 'ARCHIVE_IMPORT' && !entry.channel.allowed_domains?.length) {
      console.error(`❌ Saknar channel.allowed_domains för ${entry.artifact_id}`);
      continue;
    }
    if (entry.channel.channel_type === 'ARCHIVE_IMPORT' && !entry.channel.archive_id?.trim()) {
      console.error(`❌ Saknar channel.archive_id för ${entry.artifact_id}`);
      continue;
    }
    if (!entry.policy || entry.policy.rate_limit_requests_per_second === undefined) {
      console.error(`❌ Saknar policy/rate_limit för ${entry.artifact_id}`);
      continue;
    }
    if (!entry.change_detection || !entry.approval_attestation) {
      console.error(`❌ Saknar change_detection eller approval_attestation för ${entry.artifact_id}`);
      continue;
    }

    console.log(`✅ [${entry.producer.producer_id}] ${entry.source_id}`);
    if (entry.channel.channel_type === 'ARCHIVE_IMPORT') {
      console.log(`   Channel: ${entry.channel.channel_type} ${entry.channel.archive_id}`);
      console.log(`   Archive ID: ${entry.channel.archive_id}`);
    } else {
      console.log(`   Channel: ${entry.channel.channel_type} ${entry.channel.endpoint_url ?? '(adapter-discovered)'}`);
      console.log(`   Domains: ${entry.channel.allowed_domains.join(', ')}`);
    }
    console.log(`   Rate limit: ${entry.policy.rate_limit_requests_per_second} req/s`);
    console.log(`   Concurrency: ${entry.policy.concurrency_limit}\n`);
    validCount++;
  }

  if (validCount === registry.length) {
    console.log(`🎉 Validering lyckades! ${validCount}/${registry.length} poster uppfyller v3-policyn.`);
  } else {
    console.error(`⚠️ Validering misslyckades för ${registry.length - validCount} poster.`);
    process.exit(1);
  }
}

validateRegistry();

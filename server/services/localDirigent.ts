/**
 * localDirigent.ts
 *
 * "Beviset" mot naken chatt: compliance-flödets faktiska siffror kommer från
 * deterministiska verktyg (regelmotor) och serialiseras i `toolTrace` innan
 * valfri lokal text används. Modellen får då bara parafrasera spåret — inte
 * hitta nya risknivåer eller nya "lagkrav" som inte fanns i output.
 */

import { createHash } from 'node:crypto';
import {
  runComplianceWorkflowWithToolTrace,
  type ComplianceToolTraceEntry,
  type OrchestrationRequest,
  type OrchestrationWithToolTrace,
} from '../../services/orchestrationService';
import { generateText as generateLocalText, isLocalGenerationAvailable } from '../modules/ai/generation/LocalGenerationPort';
import { logger } from '../logger';

const SUMMARY_SYSTEM = `Du är en teknisk redaktör för miljö- och avfallscompliance.
Du får ENDAST använda information som explicit finns i JSON-objektet "verifiedToolTrace".
Inga nya lagar, inga nya risknivåer, inga siffror som inte redan står där.
Om något saknas, säg att det framgår av jämförelsedokumentet (toolTrace) men utveckla inte.
Svar på svenska, kort och punktform där det passar.`;

/**
 * Kör samma tre pass som `runComplianceWorkflow` men returnerar `toolTrace`
 * för styrning, audit och frivillig LLM-sammanfattning.
 */
export async function runDirigentCompliance(
  req: OrchestrationRequest,
): Promise<OrchestrationWithToolTrace> {
  return runComplianceWorkflowWithToolTrace(req);
}

/**
 * Stabil "revisionsspår-nyckel" från verktygsutdata (för test att samma svar ⇒ samma bevis).
 */
export function toolTraceContentHash(trace: ComplianceToolTraceEntry[]): string {
  return createHash('sha256')
    .update(JSON.stringify(trace), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

/**
 * Frivillig sammanfattning via lokal generering. Utan registrerad lokal runtime returneras en
 * minimal maskinrapport så att CI/edge utan moln fortfarande bevisar spåret.
 */
export async function summarizeVerifiedToolTrace(
  trace: ComplianceToolTraceEntry[],
  options: { useLocalGenerationIfAvailable?: boolean } = {},
): Promise<string> {
  const use = options.useLocalGenerationIfAvailable !== false;
  if (!use || !isLocalGenerationAvailable()) {
    const rule = trace.find((t) => t.toolId === 'rule_engine_evaluate')?.output as
      | { riskScore?: string; requiresPermitOrNotification?: string }
      | undefined;
    return [
      '[offline/utan lokal generering] Verifierat verktygsspår (hash: ' + toolTraceContentHash(trace) + ')',
      'rule_engine riskScore: ' + (rule?.riskScore ?? 'saknas'),
      'krav: se toolTrace-JSON; ingen LLM har lagt till innehåll.',
    ].join('\n');
  }

  try {
    const payload = JSON.stringify({ verifiedToolTrace: trace }, null, 0);
    return await generateLocalText(
      'Summera följande ENDAST. Lägg inte till nya fakta:\n' + payload,
      {
        profile: 'fast',
        temperature: 0,
        maxOutputTokens: 1024,
        systemInstruction: SUMMARY_SYSTEM,
      },
    );
  } catch (e) {
    logger.warn('localDirigent: summarize failed, faller tillbaka till offline-rapport', {
      err: e instanceof Error ? e.message : String(e),
    });
    return summarizeVerifiedToolTrace(trace, { useLocalGenerationIfAvailable: false });
  }
}

/**
 * Hjälp: full kedja + valfri sammanfattning (för API-experiment).
 */
export async function runDirigentWithOptionalSummary(
  req: OrchestrationRequest,
  options: { withSummary?: boolean } = {},
): Promise<OrchestrationWithToolTrace & { summaryText?: string; traceContentHash: string }> {
  const full = await runDirigentCompliance(req);
  const traceContentHash = toolTraceContentHash(full.toolTrace);
  if (!options.withSummary) {
    return { ...full, traceContentHash };
  }
  const summaryText = await summarizeVerifiedToolTrace(full.toolTrace);
  return { ...full, summaryText, traceContentHash };
}

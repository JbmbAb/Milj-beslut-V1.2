/**

 * Mimer classifier — binds fingerprints to ClassifierArtifacts.

 * Responsibility: classify. Not harvest (the harvest runtime). Not CAS bind (Mimer core).

 */

import {

  actionForConfidence,

  buildClassifierArtifact,

  type ClassifierArtifact,

  type PathFingerprint,

} from './ClassifierArtifact';

import { DOCUMENT_INGEST_RULES, type ClassificationRule } from './rules';



export type ClassifyOptions = {

  readonly artifact_id: string;

  readonly rules?: readonly ClassificationRule[];

  readonly classifier_id?: string;

};



export type ClassifyResult = {

  readonly artifact: ClassifierArtifact;

  readonly matched_rule_id: string | null;

};



export function classifyFingerprint(

  fingerprint: PathFingerprint,

  options: ClassifyOptions,

): ClassifyResult {

  const rules = options.rules ?? DOCUMENT_INGEST_RULES;

  let best: ClassificationRule | null = null;



  for (const rule of rules) {

    if (!rule.test(fingerprint)) continue;

    if (!best || rule.confidence > best.confidence) best = rule;

  }



  if (!best) {

    const artifact = buildClassifierArtifact({

      artifact_id: options.artifact_id,

      input_path: fingerprint.rel_path,

      fingerprint,

      predicted_provider: null,

      predicted_dataset: null,

      predicted_target: null,

      confidence: 0.2,

      reasoning: 'No rule matched — quarantine/review.',

      matched_patterns: [],

      action: actionForConfidence(0.2),

      classifier_id: options.classifier_id,

    });

    return { artifact, matched_rule_id: null };

  }



  const artifact = buildClassifierArtifact({

    artifact_id: options.artifact_id,

    input_path: fingerprint.rel_path,

    fingerprint,

    predicted_provider: best.predicted_provider,

    predicted_dataset: best.predicted_dataset,

    predicted_target: best.predicted_target,

    confidence: best.confidence,

    reasoning: best.reasoning,

    matched_patterns: [best.id],

    action: actionForConfidence(best.confidence),

    classifier_id: options.classifier_id,

  });



  return { artifact, matched_rule_id: best.id };

}



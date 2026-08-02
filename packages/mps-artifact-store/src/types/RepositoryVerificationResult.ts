import { VerificationResult } from './VerificationResult.js';

export interface RepositoryVerificationStages {
  readonly hash: VerificationResult;
  readonly schema: VerificationResult;
  readonly signature: VerificationResult;
  readonly lineage: VerificationResult;
}

export interface RepositoryVerificationResult {
  readonly overall: VerificationResult;
  readonly stages: RepositoryVerificationStages;
}
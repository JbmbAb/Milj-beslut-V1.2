import express from 'express';
import path from 'node:path';
import { FileCASRepository } from '@miljobeslut/mimers-brunn-core';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { getDocumentEvidenceAdmissionSigningProvider } from '../security/documentEvidenceAdmissionSigningKey';
import { getDocumentEvidenceAdmissionVerifier } from '../security/documentEvidenceAdmissionVerifier';
import { admitDocumentEvidenceV2 } from '../services/documentEvidenceAdmissionBridge';
import { reviewDocumentEvidenceProperty, reviewDocumentFact } from '../services/documentEvidenceReviewerAProductionPath';

export const documentEvidenceRouter = express.Router();

type CandidateReviewRef = Readonly<{
  artifact_id: string;
  artifact_type: string;
  content_hash: { algorithm: 'sha256'; value: string };
}>;

type HashedRouteRef = Readonly<{
  artifact_id: string;
  artifact_type: string;
  content_hash: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCandidateReviewRef(value: unknown): value is CandidateReviewRef {
  return (
    isRecord(value) &&
    typeof value.artifact_id === 'string' &&
    typeof value.artifact_type === 'string' &&
    isRecord(value.content_hash) &&
    value.content_hash.algorithm === 'sha256' &&
    typeof value.content_hash.value === 'string'
  );
}

function isHashedRouteRef(value: unknown): value is HashedRouteRef {
  return (
    isRecord(value) &&
    typeof value.artifact_id === 'string' &&
    typeof value.artifact_type === 'string' &&
    typeof value.content_hash === 'string'
  );
}

function hasArtifactRefShape(value: unknown): value is { artifact_id: string; artifact_type: string } {
  return isRecord(value) && typeof value.artifact_id === 'string' && typeof value.artifact_type === 'string';
}

async function canonicalArtifacts(): Promise<Awaited<ReturnType<typeof MimersIntegration.create>>> {
  if (!process.env.MIMERS_ROOT?.trim()) {
    const error = new Error('MIMERS_ROOT is required for governed document review');
    error.name = 'DocumentEvidenceReviewUnavailable';
    throw error;
  }
  return MimersIntegration.create({ forceMimers: true });
}

documentEvidenceRouter.post('/api/document-evidence/review-fact', requireAuth, rateLimitByUser(10, 60_000), async (req, res, next) => {
  try {
    const candidateRef = req.body?.candidateRef;
    const verificationMethod = req.body?.verificationMethod;
    const governanceRelease = String(req.body?.governanceRelease || '').trim();
    if (!isCandidateReviewRef(candidateRef) || !verificationMethod || !governanceRelease) {
      res.status(400).json({ ok: false, error: 'candidateRef, verificationMethod, and governanceRelease are required' });
      return;
    }
    const mimers = await canonicalArtifacts();
    const result = await reviewDocumentFact({
      authUser: req.authUser!, candidate_ref: candidateRef, verification_method: verificationMethod,
      governance_release: governanceRelease, verified_at: new Date().toISOString(), artifactRepository: mimers.artifactRepository,
    });
    res.status(201).json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentEvidenceReviewUnavailable') {
      res.status(503).json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
});

documentEvidenceRouter.post('/api/document-evidence/review-property', requireAuth, rateLimitByUser(10, 60_000), async (req, res, next) => {
  try {
    const governanceRelease = String(req.body?.governanceRelease || '').trim();
    const verifiedFactRefs = req.body?.verifiedFactRefs;
    const justificationRefs = req.body?.justificationRefs;
    if (
      !isHashedRouteRef(req.body?.documentEvidenceRef) ||
      !Array.isArray(verifiedFactRefs) ||
      !verifiedFactRefs.every(isHashedRouteRef) ||
      !isHashedRouteRef(req.body?.propertyRef) ||
      !Array.isArray(justificationRefs) ||
      !justificationRefs.every(hasArtifactRefShape) ||
      !governanceRelease
    ) {
      res.status(400).json({ ok: false, error: 'documentEvidenceRef, verifiedFactRefs, propertyRef, justificationRefs, and governanceRelease are required' });
      return;
    }
    const mimers = await canonicalArtifacts();
    const result = await reviewDocumentEvidenceProperty({
      authUser: req.authUser!, document_evidence_ref: req.body.documentEvidenceRef,
      verified_fact_refs: verifiedFactRefs, property_ref: req.body.propertyRef,
      justification_refs: justificationRefs, governance_release: governanceRelease,
      artifactRepository: mimers.artifactRepository,
    });
    res.status(201).json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentEvidenceReviewUnavailable') {
      res.status(503).json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
});

documentEvidenceRouter.post('/api/document-evidence/admit', requireAuth, rateLimitByUser(10, 60_000), async (req, res, next) => {
  try {
    const root = process.env.MIMERS_ROOT?.trim();
    if (!root) {
      res.status(503).json({ ok: false, error: 'MIMERS_ROOT is required for document evidence admission' });
      return;
    }
    const evidence = req.body?.evidence;
    const propertyBinding = req.body?.propertyBinding;
    const governanceRelease = String(req.body?.governanceRelease || '').trim();
    if (!evidence || !propertyBinding || !governanceRelease) {
      res.status(400).json({ ok: false, error: 'evidence, propertyBinding, and governanceRelease are required' });
      return;
    }
    const mimers = await MimersIntegration.create({ forceMimers: true });
    const cas = new FileCASRepository(path.join(root, 'cas'), {
      durabilityMode: (process.env.MIMERS_DURABILITY_MODE as 'none' | 'best-effort' | 'strict') || 'best-effort',
    });
    await cas.initialize();
    const result = await admitDocumentEvidenceV2({
      authUser: req.authUser!,
      evidence,
      propertyBinding,
      governanceRelease,
      artifactRepository: mimers.artifactRepository,
      cas,
      signing: getDocumentEvidenceAdmissionSigningProvider(),
      verification: getDocumentEvidenceAdmissionVerifier(),
    });
    res.status(201).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

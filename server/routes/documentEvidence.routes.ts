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

async function canonicalArtifacts(req: express.Request): Promise<Awaited<ReturnType<typeof MimersIntegration.create>>> {
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required for governed document review');
  return MimersIntegration.create({ forceMimers: true });
}

documentEvidenceRouter.post('/api/document-evidence/review-fact', requireAuth, rateLimitByUser(10, 60_000), async (req, res, next) => {
  try {
    const candidateRef = req.body?.candidateRef;
    const verificationMethod = req.body?.verificationMethod;
    const governanceRelease = String(req.body?.governanceRelease || '').trim();
    if (!candidateRef || !verificationMethod || !governanceRelease) {
      res.status(400).json({ ok: false, error: 'candidateRef, verificationMethod, and governanceRelease are required' });
      return;
    }
    const mimers = await canonicalArtifacts(req);
    const result = await reviewDocumentFact({
      authUser: req.authUser!, candidate_ref: candidateRef, verification_method: verificationMethod,
      governance_release: governanceRelease, verified_at: new Date().toISOString(), artifactRepository: mimers.artifactRepository,
    });
    res.status(201).json({ ok: true, result });
  } catch (error) { next(error); }
});

documentEvidenceRouter.post('/api/document-evidence/review-property', requireAuth, rateLimitByUser(10, 60_000), async (req, res, next) => {
  try {
    const governanceRelease = String(req.body?.governanceRelease || '').trim();
    if (!req.body?.documentEvidenceRef || !req.body?.verifiedFactRefs || !req.body?.propertyRef || !req.body?.justificationRefs || !governanceRelease) {
      res.status(400).json({ ok: false, error: 'documentEvidenceRef, verifiedFactRefs, propertyRef, justificationRefs, and governanceRelease are required' });
      return;
    }
    const mimers = await canonicalArtifacts(req);
    const result = await reviewDocumentEvidenceProperty({
      authUser: req.authUser!, document_evidence_ref: req.body.documentEvidenceRef,
      verified_fact_refs: req.body.verifiedFactRefs, property_ref: req.body.propertyRef,
      justification_refs: req.body.justificationRefs, governance_release: governanceRelease,
      artifactRepository: mimers.artifactRepository,
    });
    res.status(201).json({ ok: true, result });
  } catch (error) { next(error); }
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

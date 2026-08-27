import express from 'express';
import path from 'node:path';
import { FileCASRepository } from '@miljobeslut/mimers-brunn-core';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { getDocumentEvidenceAdmissionSigningProvider } from '../security/documentEvidenceAdmissionSigningKey';
import { getDocumentEvidenceAdmissionVerifier } from '../security/documentEvidenceAdmissionVerifier';
import { admitDocumentEvidenceV2 } from '../services/documentEvidenceAdmissionBridge';

export const documentEvidenceRouter = express.Router();

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

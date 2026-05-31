/**
 * Sewage Analysis API Route
 * Analyzes property for private sewage system suitability
 */

import express from 'express';
import { requireAuth } from '../security/auth';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  analyzeSewageProperty,
  generateSewageProtectionProfile,
  generateSewageRequirementChecklist,
  type SewageAnalysisRequest,
} from '../modules/sewageAdmin/public';

const router = express.Router();

/**
 * POST /api/sewage/analyze
 * Analyze property for sewage system suitability using GIS data
 */
router.post('/api/sewage/analyze', requireAuth, async (req, res) => {
  try {
    const { propertyDesignation, municipalityCode, latitude, longitude, pe } = req.body;

    if (!propertyDesignation || !municipalityCode || latitude == null || longitude == null || pe == null) {
      res.status(400).json({
        ok: false,
        error:
          'Missing required fields: propertyDesignation, municipalityCode, latitude, longitude, pe (1-200)',
      });
      return;
    }

    const peNumber = Number(pe);
    if (peNumber < 1 || peNumber > 200 || !Number.isInteger(peNumber)) {
      res.status(400).json({
        ok: false,
        error: 'PE (Person Equivalents) must be an integer between 1 and 200',
      });
      return;
    }

    console.log(
      `[SewageAnalysis] Analyzing property ${propertyDesignation} for ${peNumber} PE (${municipalityCode})...`,
    );

    const analysisRequest: SewageAnalysisRequest = {
      propertyDesignation,
      municipalityCode,
      latitude: Number(latitude),
      longitude: Number(longitude),
      pe: peNumber,
    };

    // 1. Run GIS analysis
    const gisAnalysis = await analyzeSewageProperty(analysisRequest);

    // 2. Generate protection profile
    const protectionProfile = await generateSewageProtectionProfile(gisAnalysis, municipalityCode);

    res.json({
      ok: true,
      analysis: gisAnalysis,
      protectionProfile,
    });
  } catch (error: unknown) {
    console.error('[SewageAnalysis] Error:', error);
    res.status(400).json(toSafeErrorResponse(error));
  }
});

/**
 * POST /api/sewage/requirement-checklist
 * Generate legal requirement checklist for a sewage system configuration
 */
router.post('/api/sewage/requirement-checklist', requireAuth, async (req, res) => {
  try {
    const { systemType, protectionLevel, municipalityCode, distanceData } = req.body ?? {};

    if (!systemType || !protectionLevel || !municipalityCode) {
      res.status(400).json({
        ok: false,
        error: 'Missing required fields: systemType, protectionLevel, municipalityCode',
      });
      return;
    }

    const requirements = generateSewageRequirementChecklist(
      systemType,
      protectionLevel,
      municipalityCode,
      distanceData,
    );

    res.json({ ok: true, requirements });
  } catch (error: unknown) {
    console.error('[SewageRequirementChecklist] Error:', error);
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;

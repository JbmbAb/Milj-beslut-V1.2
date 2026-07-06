import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  calculateRadialOpenAquifer,
  calculateOneDimOpenAquifer,
  calculateRadialConfinedAquifer,
  calculateOneDimConfinedAquifer,
  estimateInfluenceRadiusSichardt,
  GroundwaterModelInput,
  calculateStormwaterDetention,
  calculateVaProjectClimate,
  StormwaterCalculationInput,
  VaClimateInput,
} from '../modules/gis/public';

const router = express.Router();

router.post('/api/hydro/calculate-influence', requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    const { modelType, ...input } = req.body as { modelType: string } & GroundwaterModelInput;

    if (!modelType) {
      return res.status(400).json({ ok: false, error: 'modelType is required' });
    }

    let result;
    switch (modelType) {
      case 'radial_open':
        result = calculateRadialOpenAquifer(input as any);
        break;
      case 'one_dim_open':
        result = calculateOneDimOpenAquifer(input as any);
        break;
      case 'radial_confined':
        result = calculateRadialConfinedAquifer(input as any);
        break;
      case 'one_dim_confined':
        result = calculateOneDimConfinedAquifer(input as any);
        break;
      default:
        return res.status(400).json({ ok: false, error: `Invalid modelType: ${modelType}` });
    }

    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/hydro/estimate-radius', requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    const { drawdown, hydraulicConductivityK } = req.body as { drawdown: number, hydraulicConductivityK: number };
    
    if (drawdown === undefined || hydraulicConductivityK === undefined) {
      return res.status(400).json({ ok: false, error: 'drawdown and hydraulicConductivityK are required' });
    }

    const radius = estimateInfluenceRadiusSichardt(drawdown, hydraulicConductivityK);
    res.json({ ok: true, radius });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

/**
 * POST /api/hydro/svenskt-vatten/p110
 * Utför P110 dagvattenavledning och fördröjningsberäkning (rationella metoden + Dahlström)
 */
router.post('/api/hydro/svenskt-vatten/p110', requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    const input = req.body as StormwaterCalculationInput;
    if (!input.areaM2 || !input.runoffCoefficient || !input.returnPeriodYears || !input.durationMinutes || !input.climateFactor) {
      return res.status(400).json({ ok: false, error: 'Saknade obligatoriska parametrar (areaM2, runoffCoefficient, returnPeriodYears, durationMinutes, climateFactor)' });
    }
    const result = calculateStormwaterDetention(input);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

/**
 * POST /api/hydro/svenskt-vatten/klimat-va
 * Beräknar klimatpåverkan (CO2e) för ett VA-anläggningsprojekt (schakt, rör, transporter)
 */
router.post('/api/hydro/svenskt-vatten/klimat-va', requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    const input = req.body as VaClimateInput;
    if (!input.trenchLengthM || !input.trenchWidthM || !input.trenchDepthM || input.reusePercentage === undefined || !input.pipes || input.transportDistanceKm === undefined) {
      return res.status(400).json({ ok: false, error: 'Saknade obligatoriska parametrar (trenchLengthM, trenchWidthM, trenchDepthM, reusePercentage, pipes, transportDistanceKm)' });
    }
    const result = calculateVaProjectClimate(input);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;

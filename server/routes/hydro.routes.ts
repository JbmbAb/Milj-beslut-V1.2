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
} from '../services/groundwaterInfluenceService';

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

export default router;

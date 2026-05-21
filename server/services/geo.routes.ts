/**
 * geo.routes.ts
 *
 * API routes for geospatial lookups and operations.
 */

import express from 'express';
import { requireAuth } from '../security/auth';
import { lookupPropertyByDesignation } from '../services/lantmaterietService';
import { logger } from '../logger';

const router = express.Router();

/**
 * POST /api/geo/property-lookup
 *
 * Looks up a property by its designation (fastighetsbeteckning) and returns
 * its geometry and other relevant data.
 */
router.post('/api/geo/property-lookup', requireAuth, async (req, res, next) => {
  try {
    const { propertyDesignation, projectId, purpose } = req.body;

    if (!propertyDesignation || !projectId) {
      return res.status(400).json({ error: 'propertyDesignation and projectId are required' });
    }

    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await lookupPropertyByDesignation(
      { propertyDesignation, projectId, purpose },
      req.authUser,
    );

    res.json(result);
  } catch (error) {
    logger.error('Property lookup failed', { error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
});

export default router;

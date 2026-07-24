import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { prisma } from '../db/prisma';
import { AlphaevolveSearchService } from '../services/searchService';
import { logger } from '../logger';

const router = Router();
const searchService = new AlphaevolveSearchService(prisma);

/**
 * GET /api/search
 * Executing hybrid RAG search using AlphaevolveSearchService
 */
router.get(
  '/api/search',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query.query as string;
      if (!query) {
        return res.status(400).json({ ok: false, error: 'Query parameter is required' });
      }

      // Parse optional category
      const category = req.query.category as string;

      // Parse optional bbox spatial filters
      let bbox: [number, number, number, number] | undefined;
      const bboxStr = req.query.bbox as string;
      if (bboxStr) {
        const parts = bboxStr.split(',').map((p) => parseFloat(p.trim()));
        if (parts.length === 4 && parts.every((num) => !isNaN(num))) {
          bbox = [parts[0], parts[1], parts[2], parts[3]];
        } else {
          return res.status(400).json({
            ok: false,
            error: 'Invalid bbox format. Use minLng,minLat,maxLng,maxLat',
          });
        }
      }

      // Parse configurable configuration parameters
      const rrf_k = req.query.rrf_k ? parseInt(req.query.rrf_k as string, 10) : undefined;
      const fts_limit = req.query.fts_limit ? parseInt(req.query.fts_limit as string, 10) : undefined;
      const vector_limit = req.query.vector_limit ? parseInt(req.query.vector_limit as string, 10) : undefined;
      const rerank_limit = req.query.rerank_limit ? parseInt(req.query.rerank_limit as string, 10) : undefined;
      const top_k = req.query.top_k ? parseInt(req.query.top_k as string, 10) : undefined;
      const rerank = req.query.rerank === 'true';

      const config: any = {};
      if (rrf_k !== undefined && !isNaN(rrf_k)) config.RRF_K = rrf_k;
      if (fts_limit !== undefined && !isNaN(fts_limit)) config.FTS_CANDIDATE_LIMIT = fts_limit;
      if (vector_limit !== undefined && !isNaN(vector_limit)) config.VECTOR_CANDIDATE_LIMIT = vector_limit;
      if (rerank_limit !== undefined && !isNaN(rerank_limit)) config.CROSS_ENCODER_LIMIT = rerank_limit;
      if (top_k !== undefined && !isNaN(top_k)) config.FINAL_TOP_K = top_k;
      config.CROSS_ENCODER_ENABLED = rerank;

      logger.info('Executing Alphaevolve search', { query, category, bbox, config });

      const results = await searchService.search(query, {
        category,
        bbox,
        config,
      });

      res.json({
        ok: true,
        results,
      });
    } catch (error) {
      logger.error('Error in search endpoint', { error });
      next(error);
    }
  }
);

export default router;

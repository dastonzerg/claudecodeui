import express from 'express';

import type { createBookmarksService } from './bookmarks.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

/** Creates thin Bookmarks transport handlers around the application service. */
export function createBookmarksRouter(
  service: ReturnType<typeof createBookmarksService>,
): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  router.get('/', respond((req) => (
    typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
      ? service.listForSession(userId(req), req.query.sessionId)
      : service.listAll(userId(req))
  )));
  router.post('/', respond((req) => service.create(userId(req), req.body ?? {})));
  router.patch('/:id', respond((req) => service.rename(
    userId(req), Number(req.params.id), req.body?.label,
  )));
  router.patch('/:id/anchor', respond((req) => service.updateAnchor(
    userId(req), Number(req.params.id), req.body?.messageId,
  )));
  router.delete('/:id', respond((req) => service.remove(userId(req), Number(req.params.id))));
  return router;
}

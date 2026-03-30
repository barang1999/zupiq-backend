import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  NotFoundError,
  ValidationError,
} from "../middlewares/error.middleware.js";
import {
  createInvitation,
  getInvitationPreview,
  acceptInvitation,
  getSessionMembers,
  removeSessionMember,
  canUserAccessSession,
} from "../../services/collaboration.service.js";
import {
  setupCollabStreamHeaders,
  registerCollabStreamClient,
  publishCollabEvent,
} from "../../services/collab-stream.js";

const router = Router();

// ─── POST /api/sessions/:id/invite ───────────────────────────────────────────
// Create a reusable invite link for the session.

router.post(
  "/sessions/:id/invite",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role = "editor" } = req.body as { role?: string };
      if (!["editor", "viewer"].includes(role)) {
        throw new ValidationError('role must be "editor" or "viewer"');
      }
      const invitation = await createInvitation(
        req.params.id,
        req.user!.sub,
        role as "editor" | "viewer"
      );
      res.status(201).json({ invitation });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/sessions/:id/members ───────────────────────────────────────────
// List all members including the owner.

router.get(
  "/sessions/:id/members",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const canAccess = await canUserAccessSession(req.params.id, req.user!.sub);
      if (!canAccess) throw new NotFoundError("Session");
      const members = await getSessionMembers(req.params.id);
      res.json({ members });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/sessions/:id/members/:memberId ──────────────────────────────
// Remove a member (owner removes anyone; member can leave themselves).

router.delete(
  "/sessions/:id/members/:memberId",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await removeSessionMember(
        req.params.id,
        req.params.memberId,
        req.user!.sub
      );
      publishCollabEvent(req.params.id, "member_left", {
        userId: req.params.memberId,
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/sessions/:id/collab/stream ─────────────────────────────────────
// SSE stream — broadcasts collab events to all members currently viewing.

router.get(
  "/sessions/:id/collab/stream",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const canAccess = await canUserAccessSession(req.params.id, req.user!.sub);
      if (!canAccess) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      setupCollabStreamHeaders(res);
      registerCollabStreamClient(req.params.id, res);

      // Send the initial connected event so the client knows it's live.
      res.write(`event: connected\n`);
      res.write(
        `data: ${JSON.stringify({
          sessionId: req.params.id,
          userId: req.user!.sub,
        })}\n\n`
      );
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/invitations/:token ─────────────────────────────────────────────
// Preview an invitation before accepting (no auth required for the preview).

router.get(
  "/invitations/:token",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitation = await getInvitationPreview(req.params.token);
      if (!invitation) throw new NotFoundError("Invitation");
      res.json({ invitation });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/invitations/:token/accept ─────────────────────────────────────
// Accept an invitation and join the session.

router.post(
  "/invitations/:token/accept",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await acceptInvitation(req.params.token, req.user!.sub);
      publishCollabEvent(result.sessionId, "member_joined", {
        userId: req.user!.sub,
      });
      res.json({ sessionId: result.sessionId });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

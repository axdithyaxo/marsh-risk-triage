import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { requireRole } from "../middleware.js";
import { parseBody, sendAgentError } from "./http.js";

const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function createLedgerRouter({ logger, agent }: Deps) {
  const router = Router();
  const auditors = requireRole("auditor");

  // GET /api/ledger?limit=&offset= — the recorded human decisions, oldest
  // first, plus head_hash/count for the whole log.
  router.get("/ledger", auditors, async (req, res) => {
    const paging = parseBody(Paging, req.query, res);
    if (!paging) return;
    const qs = new URLSearchParams();
    if (paging.limit !== undefined) qs.set("limit", String(paging.limit));
    if (paging.offset !== undefined) qs.set("offset", String(paging.offset));
    try {
      res.json(await agent.ledger(qs.size ? `?${qs}` : "", String(req.id)));
    } catch (err) {
      sendAgentError(err, res, logger);
    }
  });

  // GET /api/ledger/verify — re-checks every link and signature on disk.
  router.get("/ledger/verify", auditors, async (req, res) => {
    try {
      res.json(await agent.verify(String(req.id)));
    } catch (err) {
      sendAgentError(err, res, logger);
    }
  });

  return router;
}

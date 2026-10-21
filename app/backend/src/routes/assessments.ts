import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { requireAuth } from "../middleware.js";
import { toSummary, toView, type AssessmentRow } from "../views.js";
import { parseBody } from "./http.js";

const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const SELECT = `SELECT a.*, o.email AS owner_email, d.email AS decider_email
                FROM assessments a JOIN users o ON o.id = a.user_id LEFT JOIN users d ON d.id = a.decided_by`;

export function createAssessmentsRouter({ db }: Deps) {
  const router = Router();

  // Underwriters see their own work; auditors see everyone's (read-only).
  router.get("/assessments", requireAuth, (req, res) => {
    const paging = parseBody(Paging, req.query, res);
    if (!paging) return;
    const scope = req.user!.role === "auditor" ? "" : "WHERE a.user_id = ?";
    const args = req.user!.role === "auditor" ? [] : [req.user!.id];
    const rows = db
      .prepare(`${SELECT} ${scope} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, paging.limit, paging.offset) as AssessmentRow[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM assessments a ${scope}`).get(...args) as { n: number }).n;
    res.json({
      total,
      assessments: rows.map((r) => toSummary(req.user!.role === "auditor" ? r : { ...r, owner_email: undefined })),
    });
  });

  router.get("/assessments/:id", requireAuth, (req, res) => {
    const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(req.params.id) as AssessmentRow | undefined;
    // Someone else's assessment looks exactly like a missing one.
    if (!row || (req.user!.role !== "auditor" && row.user_id !== req.user!.id)) {
      return void res.status(404).json({ error: "not found" });
    }
    res.json(toView(req.user!.role === "auditor" ? row : { ...row, owner_email: undefined, decider_email: undefined }));
  });

  return router;
}

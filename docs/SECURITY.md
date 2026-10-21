# Security model

This is a threat model for what is actually built, including what is *not*
protected. All data in the demo is synthetic.

## What is being protected

| Asset | Why it matters |
|---|---|
| The **audit log** of bind/refer decisions | It is the evidence of who decided what, on what information. Its value is that it can't be quietly changed. |
| **Accounts and sessions** | They decide who may submit, decide and read. |
| **Submissions** | They can contain personal data (PPSN, phone, email, names, addresses). |
| **The model's cost** | Each assessment is several LLM calls; abuse is a denial-of-wallet and a denial-of-service. |

## Trust boundaries

```
 Browser ──HTTPS──▶ [reverse proxy / TLS]  ──▶  frontend (nginx, static)
    │                                              
    └──cookie session──▶ backend (Express) ──X-Internal-Token──▶ agent-api (FastAPI) ──▶ model
                          │ SQLite: users, sessions, assessments      │ audit_log.jsonl (hash-chained)
```

- The **browser is untrusted.** It supplies only: credentials, a submission, an
  assessment id, a decision and a rationale. It never supplies evidence, identity
  or a role.
- The **backend** is trusted to authenticate users and to assert their identity to
  the agent service.
- The **agent-api** is internal: it is not published to the host, and every route
  but `/healthz` and `/readyz` requires the shared token.
- The **model output** is untrusted data. It is parsed defensively and shown to a
  human; it never triggers an action on its own.

## Controls, by threat

| Threat | Control | Where it is tested |
|---|---|---|
| Guessing or stuffing passwords | scrypt (N=32768) with per-user salt; rate limit per IP+email and per IP; same response and equalised timing for unknown user, wrong password and disabled account | `auth.test.ts`, `password.test.ts` |
| A stolen database or backup replayed as logins | Sessions store only the SHA-256 of the token; passwords are stored only as scrypt hashes | `auth.test.ts` |
| Session theft by script | HttpOnly cookie (not readable by page JS); `SameSite=Lax`; `Secure` and `__Host-` prefix in production; strict CSP with no third-party origins (fonts are bundled) | `auth.test.ts`; headers checked against the running container |
| Cross-site request forgery | `SameSite=Lax` plus an Origin check on every state-changing request; a cookie-bearing request with no Origin is refused | `auth.test.ts` |
| A user acting beyond their role | Server-side role checks on every route; the UI hiding tabs is a convenience, not the control | `access.test.ts` |
| Reading someone else's work | Ownership check; another user's assessment returns the same 404 as a missing one | `assessments.test.ts` |
| **Forged evidence in the audit log** | The browser never sends findings. The agent signs the evidence it produced (HMAC, domain-separated key); the backend stores it and presents it back; the agent verifies the signature before recording. Any edit to the evidence, id or submission hash is rejected | `test_api.py` (every tamper variant) |
| Forged identity in the audit log | The backend sets `decided_by` from the session; the browser can't. The agent only accepts it with the service token | `assess.test.ts`, `test_api.py` |
| Calling the agent directly | Service token on every data route, constant-time comparison; not published outside the compose network | `test_api.py` |
| Double decisions / replays | The audit log is the record of what has been decided, so duplicate detection survives restarts | `test_api.py` |
| Editing, deleting or reordering past decisions | Hash-chained, HMAC-signed JSONL; `GET /ledger/verify` names the first broken entry | `test_audit_log.py` (mutation-checked) |
| Writing to a log that no longer verifies | Fails closed: HTTP 503, "decision NOT recorded"; the reviewer's assessment is kept for retry | `test_api.py`, `assess.test.ts` |
| Prompt injection | A phrase-list guard blocks known patterns before any model sees the text; blocked attempts are recorded. See limitations | eval cases, `test_api.py` |
| Oversized or malformed input | 20,000-char submission cap, 2,000-char rationale cap, 100 kB body cap, schema validation on every route | `assess.test.ts`, `app.test.ts` |
| Cost abuse | Per-user assessment rate limit | `assess.test.ts` |
| Misconfiguration in production | `APP_ENV=production` refuses to start with default or short secrets, insecure cookies, a non-HTTPS origin, or demo seeding | `config.test.ts`, `test_api.py` |
| Secrets in logs | Cookies, auth headers and the service token are redacted at the logger; bodies (submissions, rationales, passwords) are never logged | `logger.ts` |
| PII at rest | Only the *redacted* submission is stored, and a hash goes in the audit log. See limitations | `assess.test.ts` |
| Vulnerable dependencies | `npm audit` and `pip-audit` in CI; Dependabot | `.github/workflows/ci.yml` |
| Container escape / privilege | Non-root users, all capabilities dropped, `no-new-privileges`, read-only root filesystems, minimal writable paths, PID limits | `docker-compose.yml` |

## Residual risks and limits (read these)

These are real. Closing them is the work between this and a regulated deployment.

1. **No TLS here.** The stack does not terminate HTTPS. Production needs a
   reverse proxy or load balancer; the production override assumes one, and the
   app refuses insecure cookie settings in production mode.
2. **Prompt-injection defence is weak.** It is a fixed phrase list. A paraphrased
   attack that avoids every phrase is not caught. The mitigation that actually
   holds is structural: the model's output only informs a human, who decides.
3. **PII redaction is regex-only** (PPSN, phone, email). Names and street
   addresses are not detected, so they can be stored in the assessment history.
   A real deployment needs an NER-based detector, a retention policy and
   encryption at rest. The agent's flight-recorder logs also snapshot the raw
   submission; compose keeps them on tmpfs so they are never persisted.
4. **Anyone holding the signing secret can rewrite and re-sign the audit log.**
   Tail truncation is also invisible to `verify` on its own. Mitigate by keeping
   `head_hash` and the entry count somewhere the log's owner can't edit, and by
   keeping the secret out of the application's own filesystem and out of source control.
5. **No key rotation for the audit log.** Entries are signed with a single key and
   carry no key id, so rotating `TRIAGE_HMAC_SECRET` makes old entries fail
   verification. See `OPERATIONS.md` for the interim procedure. Key versioning is
   the right fix and is not built.
6. **Authentication is passwords only.** No MFA, no SSO/OIDC, no account
   recovery, no password change or admin UI, no lockout beyond rate limiting.
   Accounts are created from the command line.
7. **Rate limits are in memory,** so they are correct for one instance and reset
   on restart. Scaling out needs a shared store.
8. **Single node.** SQLite and a file-based audit log mean one backend and one
   agent instance. Concurrency across processes is not handled.
9. **Reviewer identity in the audit log is a user id,** not a name, so reading it
   needs the users table. That is deliberate (less personal data in the log) but
   means the log alone doesn't say who someone was.
10. **Not independently assessed.** No penetration test, no formal review, no
    DPIA or equivalent compliance work has been done.

## Reporting

This is a portfolio project. Please open an issue on the repository.

# Operations

## Run

**Local / demo** (development mode; demo users are created on first start):

```bash
docker compose up --build              # frontend http://localhost:5173
docker compose logs backend | grep -A2 "DEMO LOGINS"    # the generated demo password
```

Set `DEMO_PASSWORD` to choose it. The model must be reachable: by default the
containers call Ollama on the host (`OLLAMA_API_BASE`).

**Production-style** (strict mode; secrets required; TLS is yours to provide):

```bash
export TRIAGE_HMAC_SECRET=$(openssl rand -base64 48)
export TRIAGE_INTERNAL_TOKEN=$(openssl rand -base64 48)
export ALLOWED_ORIGIN=https://app.example.com PUBLIC_BACKEND_URL=https://api.example.com
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Put a reverse proxy in front that terminates HTTPS and serves the frontend
(port 8080) and the API (port 4000) on the same *site* (for example
`app.` and `api.` under one domain) so the `SameSite=Lax` session cookie is sent.
Add HSTS at the proxy. Keep the secrets in a secret manager, not in the repo.

## Accounts

There is no sign-up. Create accounts from the command line (the password comes
from the environment so it is not in the process list):

```bash
docker compose exec -e EMAIL=a@example.com -e NAME="A Name" -e ROLE=underwriter \
  -e PASSWORD='at least 12 characters' backend node dist/scripts/create-user.js
```

Roles: `underwriter` (submit, decide, see own history) and `auditor` (read-only:
all history, the audit log, verification). To disable someone immediately (this
also ends their sessions):

```bash
docker compose exec -e EMAIL=a@example.com backend node dist/scripts/disable-user.js
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `development` | `production` enforces the checks below |
| `TRIAGE_HMAC_SECRET` | dev default | agent-api. Signs the audit log and evidence. 32+ chars in production |
| `TRIAGE_INTERNAL_TOKEN` | dev default | backend and agent-api. 32+ chars in production |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | backend CORS and CSRF origin. Must be `https://` in production |
| `COOKIE_SECURE` | `false` | must be `true` in production (set by the prod override) |
| `TRUST_PROXY` | `false` | `true` behind a proxy so rate limits see the real client IP |
| `SESSION_TTL_HOURS` | `8` | absolute lifetime of a session |
| `LOGIN_RATE_MAX` | `10` | failed logins per IP+email per 15 minutes |
| `ASSESS_RATE_PER_HOUR` | `30` | per user |
| `AGENT_TIMEOUT_MS` | `150000` | backend's deadline for the model pipeline |
| `DATABASE_PATH` | `/data/app.db` | SQLite file (backend volume) |
| `TRIAGE_AUDIT_LOG_PATH` | `/data/audit_log.jsonl` | audit log (agent volume) |
| `TRIAGE_MODEL`, `TRIAGE_RAG`, `OLLAMA_API_BASE` | see `.env.example` | model and retrieval |
| `LOG_LEVEL` | `info` | pino levels |

Production refuses to start, with every problem listed, if a secret is a
default or under 32 characters, cookies aren't `Secure`, the origin isn't
`https://`, or demo seeding is on.

## Health and logs

- `GET /healthz` — liveness, both services. Used by the container healthchecks.
- `GET /readyz` (backend) — database and agent both answer. `GET /readyz` (agent)
  — the audit log verifies. Use these for load-balancer checks.
- Logs are one JSON object per line on stdout. Each request has an id
  (`X-Request-Id`), passed from the backend to the agent, so a single user
  action can be followed across both services. Cookies and credentials are
  redacted; bodies are never logged.

## The audit log

```bash
curl -b cookies http://localhost:4000/api/ledger/verify        # auditor session
```

Returns `{"ok": true, "entries": N, "head_hash": "…"}` or the first broken
entry. **Record `head_hash` and `entries` somewhere independent** after each
review (a ticket, a report): it is the only way to detect entries removed from
the end of the log.

If verification fails the agent refuses new decisions (HTTP 503) rather than
extending a broken chain. Investigate with `GET /api/ledger`, restore the log
from a backup, and re-verify. Do not edit the file by hand to "fix" it: that is
exactly what the chain detects.

## Backup and restore

- **SQLite** (`/data/app.db` in the `appdata` volume): use the online backup, not
  a plain file copy of a live WAL database:
  `docker compose exec backend node -e "require('better-sqlite3')('/data/app.db').backup('/data/backup.db').then(()=>console.log('ok'))"`
  then copy `backup.db` out of the volume.
- **Audit log** (`/data/audit_log.jsonl` in the `audit` volume): append-only, so
  copying the file is safe. Keep copies off the host, and verify a restored copy
  before use.
- Test a restore before you rely on it.

## Rotating secrets

- **`TRIAGE_INTERNAL_TOKEN`**: change it in both services and restart them
  together. No data is affected.
- **`TRIAGE_HMAC_SECRET`**: the audit log has no key versioning, so a new secret
  cannot verify entries signed with the old one. Interim procedure: archive the
  current log together with its secret and its final `head_hash`, then start a
  new log under the new secret. Evidence signed before the change also stops
  verifying, so rotate when no assessments are awaiting a decision. Key
  versioning is the proper fix and is not implemented.

## Upgrades and migrations

The database schema is versioned (`schema_migrations`); the backend applies new
migrations at startup, each in its own transaction. Migrations are append-only:
never edit one that has shipped. Take a backup before upgrading.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Decide returns 503 "decision NOT recorded" | The audit log failed verification. See above |
| Assess returns 502 "assessment service unavailable" | agent-api is down, or `TRIAGE_INTERNAL_TOKEN` differs between services (check the agent log for 401s) |
| Assess returns 504 | The model pipeline exceeded `AGENT_TIMEOUT_MS`; is the model reachable? |
| Everyone is logged out after a deploy | Sessions are in SQLite and survive restarts; check `DATABASE_PATH` points at the mounted volume |
| Backend exits at start in production | Read the error: it lists every unsafe setting |
| Login keeps returning 429 | `LOGIN_RATE_MAX` reached for that IP+email; wait 15 minutes (the limiter is in memory, a restart clears it) |

## Capacity

One backend and one agent instance, SQLite, a file-based audit log, in-memory
rate limiting. Throughput is bounded by the model (each assessment is three
parallel LLM calls, about 10–20 seconds locally). Scaling out needs a shared
database, a shared rate-limit store and a different audit-log backend.

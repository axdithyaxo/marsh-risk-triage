"""
Append-only, hash-chained audit log for human decisions.

Why this exists alongside Lár's AuthorityLedger: that ledger signs a whole
JSON file in memory and rewrites it on save, so a server restart started it
empty and the next decision overwrote all earlier history. An audit trail has
to survive restarts and make edits detectable, so each decision here is one
line in a JSONL file that is only ever appended to, and each line commits to
the one before it:

    entry_hash = HMAC-SHA256(secret, canonical_json(entry without entry_hash))

where the signed entry includes `prev_hash`, the previous entry's hash. Editing
or deleting an entry, or reordering entries, breaks the chain from that point,
and `verify()` reports where.

What this does NOT protect against, stated plainly:
  * Whoever holds the secret can rewrite the whole file and re-sign it.
  * Deleting entries from the END of the log leaves a valid shorter chain.
    `verify()` cannot see that on its own; to detect it, record `head_hash`
    and the entry count somewhere the file's owner can't edit (another system,
    a printed report) and compare later.
  * One process only. Appends are serialised by an in-process lock, so run a
    single worker.
"""
import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

GENESIS = "0" * 64


class AuditLogCorrupt(Exception):
    """The log failed verification, so no further entry may be appended to it:
    appending to a broken chain would hide the break behind newer entries."""

    def __init__(self, error: dict):
        super().__init__(f"audit log failed verification at entry {error['seq']}: {error['reason']}")
        self.error = error


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def digest(obj) -> str:
    return hashlib.sha256(canonical(obj).encode()).hexdigest()


class AuditLog:
    def __init__(self, path, secret: str):
        self.path = Path(path)
        self._secret = secret.encode()
        self._lock = threading.Lock()

    def _sign(self, body: dict) -> str:
        return hmac.new(self._secret, canonical(body).encode(), hashlib.sha256).hexdigest()

    def _lines(self) -> list:
        if not self.path.exists():
            return []
        return [line for line in self.path.read_text().splitlines() if line.strip()]

    def verify(self) -> dict:
        """Re-read the file from disk and check every entry. Never trusts
        in-memory state: the point is to check what is actually stored."""
        prev, good = GENESIS, 0
        for seq, line in enumerate(self._lines(), start=1):
            def fail(reason):
                return {"ok": False, "entries": good, "head_hash": prev,
                        "error": {"seq": seq, "reason": reason}}

            try:
                entry = json.loads(line)
            except ValueError:
                return fail("line is not valid JSON")
            if not isinstance(entry, dict) or "entry_hash" not in entry:
                return fail("entry is malformed or has no entry_hash")
            if entry.get("seq") != seq:
                return fail(f"sequence number is {entry.get('seq')!r}, expected {seq}")
            if entry.get("prev_hash") != prev:
                return fail("prev_hash does not match the previous entry (entry removed, reordered or inserted)")
            body = {k: v for k, v in entry.items() if k != "entry_hash"}
            if not hmac.compare_digest(self._sign(body), str(entry["entry_hash"])):
                return fail("signature mismatch (entry edited, or signed with a different secret)")
            if entry.get("evidence_sha256") != digest(entry.get("evidence")):
                return fail("evidence does not match its recorded hash")
            prev, good = entry["entry_hash"], seq
        return {"ok": True, "entries": good, "head_hash": prev, "error": None}

    def entries(self) -> list:
        out = []
        for seq, line in enumerate(self._lines(), start=1):
            try:
                out.append(json.loads(line))
            except ValueError:
                raise AuditLogCorrupt({"seq": seq, "reason": "line is not valid JSON"})
        return out

    def has_assessment(self, assessment_id: str) -> bool:
        """Has this assessment already been decided? Tolerates damaged lines:
        a corrupt log must surface as AuditLogCorrupt at append time, not as a
        crash here, and an unreadable line can't be a decision we can honour."""
        for line in self._lines():
            try:
                if json.loads(line).get("assessment_id") == assessment_id:
                    return True
            except (ValueError, AttributeError):
                continue
        return False

    def append(self, **fields) -> dict:
        """Add one decision. `fields` must include `evidence` (the model output
        the reviewer saw); its hash is computed here so a caller can't mismatch
        them. Raises AuditLogCorrupt rather than extending a broken chain."""
        with self._lock:
            state = self.verify()
            if not state["ok"]:
                raise AuditLogCorrupt(state["error"])
            body = {
                "seq": state["entries"] + 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "prev_hash": state["head_hash"],
                **fields,
                "evidence_sha256": digest(fields["evidence"]),
            }
            entry = {**body, "entry_hash": self._sign(body)}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a") as f:
                f.write(json.dumps(entry) + "\n")
                f.flush()
                os.fsync(f.fileno())
            return entry

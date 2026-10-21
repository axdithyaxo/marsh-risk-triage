import os
import sys
import tempfile
from pathlib import Path

# main.py reads its config at import time, so configure before it is imported.
_tmp = tempfile.mkdtemp(prefix="triage-test-")
os.environ["TRIAGE_AUDIT_LOG_PATH"] = os.path.join(_tmp, "audit_log.jsonl")
os.environ["TRIAGE_HMAC_SECRET"] = "test-secret"

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))                                   # main.py
sys.path.insert(0, str(ROOT.parent.parent / "eval" / "lar_agent"))  # retrieval.py

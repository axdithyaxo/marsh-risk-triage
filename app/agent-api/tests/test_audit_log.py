import json

import pytest

from audit_log import GENESIS, AuditLog, AuditLogCorrupt, digest

SECRET = "test-secret"


def make_log(tmp_path, secret=SECRET):
    return AuditLog(tmp_path / "audit.jsonl", secret)


def add(log, n=1, decision="bind"):
    return [
        log.append(
            assessment_id=f"a{i}",
            evidence={"model_confidence": 0.9, "note": f"case {i}"},
            decision=decision,
            rationale=f"reason {i}",
        )
        for i in range(n)
    ]


def rewrite(path, mutate):
    """Edit the file on disk the way an attacker (or a bug) would."""
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    mutate(lines)
    path.write_text("".join(json.dumps(e) + "\n" for e in lines))


def test_entries_are_chained_from_genesis(tmp_path):
    log = make_log(tmp_path)
    first, second = add(log, 2)
    assert first["seq"] == 1 and first["prev_hash"] == GENESIS
    assert second["seq"] == 2 and second["prev_hash"] == first["entry_hash"]
    assert log.verify() == {"ok": True, "entries": 2, "head_hash": second["entry_hash"], "error": None}


def test_empty_log_verifies(tmp_path):
    assert make_log(tmp_path).verify() == {"ok": True, "entries": 0, "head_hash": GENESIS, "error": None}


def test_history_survives_a_restart(tmp_path):
    """The regression this module exists for: the old ledger lost everything
    on restart. A new AuditLog on the same file must continue the chain."""
    before = add(make_log(tmp_path), 2)
    restarted = make_log(tmp_path)  # simulates a new server process
    after = restarted.append(assessment_id="a9", evidence={"x": 1}, decision="refer", rationale="r")

    assert after["seq"] == 3
    assert after["prev_hash"] == before[-1]["entry_hash"]
    assert [e["assessment_id"] for e in restarted.entries()] == ["a0", "a1", "a9"]
    assert restarted.verify()["ok"]


def test_the_log_is_append_only_on_disk(tmp_path):
    log = make_log(tmp_path)
    add(log, 1)
    snapshot = log.path.read_text()
    add(log, 1)
    assert log.path.read_text().startswith(snapshot)  # earlier bytes untouched


def test_editing_a_recorded_decision_is_detected(tmp_path):
    log = make_log(tmp_path)
    add(log, 3)
    rewrite(log.path, lambda es: es[1].update(decision="refer"))
    result = log.verify()
    assert not result["ok"]
    assert result["error"]["seq"] == 2
    assert "signature mismatch" in result["error"]["reason"]
    assert result["entries"] == 1  # entry 1 is still trustworthy


def test_editing_evidence_is_detected(tmp_path):
    log = make_log(tmp_path)
    add(log, 2)
    rewrite(log.path, lambda es: es[0]["evidence"].update(model_confidence=0.01))
    assert log.verify()["error"]["seq"] == 1


def test_evidence_hash_catches_a_consistently_resigned_edit(tmp_path):
    """Even with the secret, changing evidence without fixing its hash fails."""
    log = make_log(tmp_path)
    add(log, 1)

    def resign(es):
        es[0]["evidence"]["note"] = "forged"
        body = {k: v for k, v in es[0].items() if k != "entry_hash"}
        es[0]["entry_hash"] = log._sign(body)

    rewrite(log.path, resign)
    assert "evidence does not match" in log.verify()["error"]["reason"]


def test_deleting_a_middle_entry_is_detected(tmp_path):
    log = make_log(tmp_path)
    add(log, 3)
    rewrite(log.path, lambda es: es.pop(1))
    assert log.verify()["error"]["seq"] == 2


def test_reordering_entries_is_detected(tmp_path):
    log = make_log(tmp_path)
    add(log, 3)
    rewrite(log.path, lambda es: es.reverse())
    assert not log.verify()["ok"]


def test_a_different_secret_cannot_vouch_for_the_log(tmp_path):
    add(make_log(tmp_path), 1)
    assert not make_log(tmp_path, secret="other").verify()["ok"]


def test_garbage_line_is_reported_not_raised(tmp_path):
    log = make_log(tmp_path)
    add(log, 1)
    with open(log.path, "a") as f:
        f.write("{not json\n")
    result = log.verify()
    assert result["error"]["seq"] == 2 and "not valid JSON" in result["error"]["reason"]


def test_append_refuses_to_extend_a_broken_chain(tmp_path):
    log = make_log(tmp_path)
    add(log, 2)
    rewrite(log.path, lambda es: es[0].update(rationale="edited"))
    size = log.path.stat().st_size
    with pytest.raises(AuditLogCorrupt):
        add(log, 1)
    assert log.path.stat().st_size == size  # nothing was written


def test_tail_truncation_is_not_detectable_from_the_file_alone(tmp_path):
    """Documented limitation, pinned by a test so nobody 'discovers' it later:
    a shorter chain is still a valid chain. The defence is comparing the count
    and head_hash against a copy stored somewhere the file's owner can't edit."""
    log = make_log(tmp_path)
    entries = add(log, 3)
    anchored = {"entries": 3, "head_hash": entries[-1]["entry_hash"]}

    rewrite(log.path, lambda es: es.pop())  # drop the last decision
    result = log.verify()
    assert result["ok"]  # the file alone cannot tell
    assert (result["entries"], result["head_hash"]) != (anchored["entries"], anchored["head_hash"])


def test_digest_is_key_order_independent():
    assert digest({"a": 1, "b": 2}) == digest({"b": 2, "a": 1})


def test_a_correctly_signed_entry_that_breaks_the_chain_is_still_detected(tmp_path):
    """Someone WITH the secret splices in an entry that has the right sequence
    number, a valid signature and a matching evidence hash, but does not link to
    the entry before it. Only the prev_hash check can catch this."""
    log = make_log(tmp_path)
    add(log, 3)

    def splice(es):
        es[1]["prev_hash"] = GENESIS
        body = {k: v for k, v in es[1].items() if k != "entry_hash"}
        es[1]["entry_hash"] = log._sign(body)

    rewrite(log.path, splice)
    result = log.verify()
    assert not result["ok"] and result["error"]["seq"] == 2
    assert "prev_hash" in result["error"]["reason"]

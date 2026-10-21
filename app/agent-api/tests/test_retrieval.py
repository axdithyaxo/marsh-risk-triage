import json
import re

import pytest

import retrieval

DIMENSIONS = ("property", "financial", "regulatory")


def ids(hits):
    return [h["id"] for h in hits]


def test_flood_plain_submission_retrieves_the_flood_guideline_first():
    text = "Warehouse on the known Shannon flood plain, no flood defences, EUR 2.1m insured."
    assert ids(retrieval.retrieve(text, "property"))[0] == "G-PROP-01"


def test_sanctions_submission_retrieves_the_sanctions_guideline():
    text = "Beneficial owner is registered in a jurisdiction under sanctions."
    assert "G-REG-01" in ids(retrieval.retrieve(text, "regulatory"))


def test_new_entity_large_sum_insured_retrieves_the_financial_guideline():
    text = "Newly formed holding company, no trading history, EUR 8.5m sum insured."
    assert ids(retrieval.retrieve(text, "financial"))[0] == "G-FIN-01"


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_a_branch_only_sees_its_own_and_general_guidelines(dimension):
    prefix = {"property": "G-PROP", "financial": "G-FIN", "regulatory": "G-REG"}[dimension]
    hits = retrieval.retrieve(
        "flood plain sanctions sum insured claims turnover audited accounts", dimension, k=20
    )
    assert hits
    assert all(i.startswith((prefix, "G-GEN")) for i in ids(hits))


def test_no_term_overlap_retrieves_nothing():
    assert retrieval.retrieve("zzzz qqqq xxxx", "property") == []
    assert retrieval.retrieve("", "property") == []


def test_respects_k_and_orders_best_first():
    hits = retrieval.retrieve("flood claims construction sum insured", "property", k=2)
    assert len(hits) <= 2
    assert [h["score"] for h in hits] == sorted((h["score"] for h in hits), reverse=True)


def test_retrieval_is_deterministic():
    q = "commercial warehouse flood plain built 1978 prior water damage claim"
    assert retrieval.retrieve(q, "property") == retrieval.retrieve(q, "property")


def test_prompt_formatting():
    hits = retrieval.retrieve("flood plain", "property", k=1)
    text = retrieval.format_for_prompt(hits)
    assert text.startswith("[G-PROP-01]")
    assert retrieval.format_for_prompt([]) == "(no matching guidelines)"


def test_corpus_is_well_formed():
    chunks = retrieval.load_corpus()
    assert len(ids(chunks)) == len(set(ids(chunks)))  # unique ids
    for c in chunks:
        assert re.fullmatch(r"G-[A-Z]+-\d{2}", c["id"])
        assert c["dimension"] in (*DIMENSIONS, "general")
        assert c["title"].strip() and c["text"].strip()
    with open(retrieval.CORPUS_PATH) as f:
        assert "SYNTHETIC" in json.load(f)["_note"]

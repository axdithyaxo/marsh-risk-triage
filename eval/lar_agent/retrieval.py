"""
Guideline retrieval for the RAG step: BM25 over a small synthetic underwriting
guidelines corpus (eval/guidelines/guidelines.json).

Lexical retrieval is a deliberate choice for this corpus size: it needs no
embedding model, no vector store and no network, it is deterministic (so it can
be unit-tested in CI), and every hit is explainable by the words that matched.
With a corpus this small the cost of that choice is recall on paraphrases; the
upgrade path is hybrid BM25 + embeddings once the corpus is large enough to
justify a vector index.
"""
import json
import math
import os
import re
from collections import Counter
from functools import lru_cache

CORPUS_PATH = os.environ.get(
    "TRIAGE_GUIDELINES_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "guidelines", "guidelines.json"),
)

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was were with".split()
)
K1, B = 1.5, 0.75


def _tokens(text: str) -> list:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


@lru_cache(maxsize=1)
def load_corpus(path: str = CORPUS_PATH) -> tuple:
    with open(path) as f:
        return tuple(json.load(f)["chunks"])


def retrieve(query: str, dimension: str, k: int = 3, corpus=None) -> list:
    """Top-k guideline chunks for one risk dimension, best first.

    Candidates are the chunks tagged with that dimension plus the 'general'
    ones. Chunks with no term overlap with the query are never returned, so an
    off-topic submission retrieves nothing rather than the nearest noise.
    """
    corpus = corpus if corpus is not None else load_corpus()
    candidates = [c for c in corpus if c["dimension"] in (dimension, "general")]
    docs = [_tokens(c["title"] + " " + c["text"]) for c in candidates]
    q_terms = set(_tokens(query))
    if not candidates or not q_terms:
        return []

    n = len(docs)
    avg_len = sum(len(d) for d in docs) / n
    df = Counter(t for d in docs for t in set(d))

    scored = []
    for chunk, doc in zip(candidates, docs):
        tf = Counter(doc)
        score = 0.0
        for t in q_terms:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * tf[t] * (K1 + 1) / (tf[t] + K1 * (1 - B + B * len(doc) / avg_len))
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda s: (-s[0], s[1]["id"]))
    return [dict(c, score=round(s, 3)) for s, c in scored[:k]]


def format_for_prompt(hits: list) -> str:
    if not hits:
        return "(no matching guidelines)"
    return "\n".join(f"[{h['id']}] {h['title']}: {h['text']}" for h in hits)

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import jieba
from rank_bm25 import BM25Okapi


_WORD_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for chunk in _WORD_RE.findall(text):
        if re.fullmatch(r"[A-Za-z0-9]+", chunk):
            tokens.append(chunk.lower())
            continue
        words = [w.strip() for w in jieba.lcut(chunk) if w.strip()]
        tokens.extend(words)
    return tokens


def extract_keywords(text: str, top_k: int = 12) -> list[str]:
    tokens = [t for t in tokenize(text) if len(t) > 1]
    if not tokens:
        return []
    counter = Counter(tokens)
    return [kw for kw, _ in counter.most_common(top_k)]


def _pick_top_n(scored: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(scored) <= 2:
        return scored

    second = scored[1]["score"]
    third = scored[2]["score"]
    if third > 0 and (second == 0 or third >= second * 0.6):
        return scored[:3]
    return scored[:2]


def match_book_segments(note_text: str, segments: list[dict[str, Any]]) -> dict[str, Any]:
    if not segments:
        return {"keywords": [], "top_segments": []}

    corpus_tokens = [tokenize(seg["content"]) for seg in segments]
    bm25 = BM25Okapi(corpus_tokens)

    keywords = extract_keywords(note_text)
    query_tokens = keywords if keywords else tokenize(note_text)
    if not query_tokens:
        query_tokens = ["内容"]

    scores = bm25.get_scores(query_tokens)
    scored: list[dict[str, Any]] = []
    for idx, seg in enumerate(segments):
        scored.append(
            {
                "segment_index": seg["segment_index"],
                "content": seg["content"],
                "score": float(scores[idx]),
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = _pick_top_n(scored)
    return {"keywords": keywords, "top_segments": top}

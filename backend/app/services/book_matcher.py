from __future__ import annotations

import re
from collections import Counter
import math
from typing import Any

import jieba
from rank_bm25 import BM25Okapi


_WORD_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")
_PURE_NUMBER_RE = re.compile(r"^\d+$")

# General Chinese stopwords + frequent filler words in OCR notes.
STOPWORDS = {
    "的",
    "了",
    "和",
    "是",
    "在",
    "就",
    "都",
    "而",
    "及",
    "与",
    "着",
    "或",
    "一个",
    "一种",
    "一些",
    "很多",
    "非常",
    "其实",
    "就是",
    "这个",
    "那个",
    "这些",
    "那些",
    "如果",
    "因为",
    "所以",
    "但是",
    "然后",
    "还有",
    "以及",
    "比如",
    "比如说",
    "已经",
    "可能",
    "可以",
    "需要",
    "进行",
    "通过",
    "对于",
    "关于",
    "没有",
    "不是",
    "什么",
    "怎么",
    "为什么",
    "有没有",
    "时候",
    "细节",
    "不要",
    "之后",
    "哪些",
    "这样",
    "那样",
    "这里",
    "那里",
    "这种",
    "那种",
    "一下",
    "一点",
    "一会",
    "然后呢",
    "就是要",
    "还是",
    "或者",
    "包括",
    "等等",
    "还有呢",
    "老师",
    "学生",
}

# Education-domain keywords to keep and prioritize in ranking.
DOMAIN_WHITELIST = {
    "班级管理",
    "课堂管理",
    "课堂纪律",
    "控班",
    "带班",
    "班主任",
    "班干部",
    "班会",
    "家校沟通",
    "家校共育",
    "作业管理",
    "分层作业",
    "备课",
    "教案",
    "磨课",
    "听评课",
    "教学设计",
    "课堂提问",
    "课堂互动",
    "学习习惯",
    "学情",
    "学困生",
    "后进生",
    "提分",
    "复盘",
    "单元测试",
    "错题本",
    "阅读理解",
    "作文",
    "语文",
    "数学",
    "英语",
    "课堂效率",
    "执行力",
    "目标管理",
    "激励机制",
    "评价反馈",
    "因材施教",
}


def _is_noise_token(token: str) -> bool:
    t = token.strip().lower()
    if not t:
        return True
    if len(t) <= 1:
        return True
    if _PURE_NUMBER_RE.fullmatch(t):
        return True
    if t in STOPWORDS:
        return True
    return False


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for chunk in _WORD_RE.findall(text):
        if re.fullmatch(r"[A-Za-z0-9]+", chunk):
            tokens.append(chunk.lower())
            continue
        words = [w.strip() for w in jieba.lcut(chunk) if w.strip()]
        tokens.extend(words)
    return tokens


def _build_phrase_candidates(tokens: list[str]) -> Counter:
    phrase_counter: Counter[str] = Counter()
    n = len(tokens)
    for i in range(n):
        for size in (2, 3):
            if i + size > n:
                continue
            parts = tokens[i : i + size]
            if any(_is_noise_token(p) for p in parts):
                continue
            phrase = "".join(parts)
            if len(phrase) < 3 or len(phrase) > 12:
                continue
            if phrase in STOPWORDS:
                continue
            if len(set(phrase)) == 1:
                continue
            phrase_counter[phrase] += 1
    return phrase_counter


def _document_frequency_for_terms(terms: list[str], corpus_texts: list[str], corpus_tokens: list[list[str]]) -> dict[str, int]:
    df: dict[str, int] = {}
    if not corpus_texts:
        return df
    for term in terms:
        if not term:
            continue
        count = 0
        if len(term) <= 2:
            for toks in corpus_tokens:
                if term in toks:
                    count += 1
        else:
            for text in corpus_texts:
                if term in text:
                    count += 1
        df[term] = count
    return df


def _apply_diversity_rank(scored: list[tuple[str, float]], top_k: int) -> list[str]:
    out: list[str] = []
    for term, _ in scored:
        if any(term in chosen or chosen in term for chosen in out):
            continue
        out.append(term)
        if len(out) >= top_k:
            break
    return out


def extract_keywords(text: str, top_k: int = 12, corpus_segments: list[str] | None = None) -> list[str]:
    tokens = [t for t in tokenize(text) if not _is_noise_token(t)]
    if not tokens:
        return []
    unigram_counter = Counter(tokens)
    phrase_counter = _build_phrase_candidates(tokens)

    terms = set(unigram_counter.keys()) | set(phrase_counter.keys())
    corpus_texts = corpus_segments or []
    corpus_tokens = [tokenize(seg) for seg in corpus_texts]
    df_map = _document_frequency_for_terms(list(terms), corpus_texts, corpus_tokens)
    n_docs = max(1, len(corpus_texts))

    scored: list[tuple[str, float]] = []
    for term in terms:
        tf = float(unigram_counter.get(term, 0) + phrase_counter.get(term, 0) * 1.4)
        if tf <= 0:
            continue
        df = df_map.get(term, 0)
        idf = math.log((n_docs + 1) / (df + 1)) + 1.0
        score = tf * idf
        if term in DOMAIN_WHITELIST:
            score += 2.0
        if term in phrase_counter:
            score += 1.2
        scored.append((term, score))

    scored.sort(key=lambda item: (-item[1], -len(item[0]), item[0]))
    ranked = _apply_diversity_rank(scored, top_k)
    if ranked:
        return ranked
    return [kw for kw, _ in scored[:top_k]]


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

    keywords = extract_keywords(note_text, corpus_segments=[seg["content"] for seg in segments])
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

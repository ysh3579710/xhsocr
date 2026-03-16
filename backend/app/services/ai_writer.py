from __future__ import annotations

import re
import time
from typing import Any

import httpx

from app.core.config import settings
from app.services.book_matcher import extract_keywords


def _normalize_tag(raw: str) -> str:
    t = raw.strip().lstrip("#").strip()
    t = re.sub(r"\s+", "", t)
    return t


def parse_tags(raw: str, target_count: int) -> list[str]:
    tags = []
    hash_tags = re.findall(r"#([^\s#]+)", raw)
    if hash_tags:
        tags = [_normalize_tag(t) for t in hash_tags if _normalize_tag(t)]
    else:
        parts = re.split(r"[\s,，、;；\n]+", raw)
        tags = [_normalize_tag(p) for p in parts if _normalize_tag(p)]

    out = []
    for t in tags:
        if t and t not in out:
            out.append(t)
        if len(out) >= target_count:
            break
    return out


class LLMClient:
    def __init__(self) -> None:
        self.provider = settings.llm_provider.lower().strip()

    def chat(self, prompt: str) -> str:
        if self.provider == "mock":
            return self._mock(prompt)
        if self.provider == "openrouter":
            return self._openrouter(prompt)
        raise RuntimeError(f"Unsupported llm provider: {self.provider}")

    def _openrouter(self, prompt: str) -> str:
        if not settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is missing.")
        base = settings.openrouter_base_url.rstrip("/")
        url = f"{base}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.openrouter_api_key}",
        }
        payload: dict[str, Any] = {
            "model": settings.openrouter_model,
            "messages": [{"role": "user", "content": prompt}],
        }
        max_attempts = max(1, settings.llm_retry_count + 1)
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
                    resp = client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                return _extract_message_text(data).strip()
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
                last_exc = exc
                if attempt >= max_attempts:
                    break
                time.sleep(max(0, settings.llm_retry_backoff_seconds))

        if last_exc is not None:
            raise RuntimeError(
                f"LLM request failed after {max_attempts} attempt(s): {last_exc.__class__.__name__}: {last_exc}"
            ) from last_exc
        raise RuntimeError("LLM request failed unexpectedly.")

def _mock(self, prompt: str) -> str:
        if "固定标签" in prompt:
            return "#成长 #复盘 #方法 #习惯 #执行"
        if "推荐正文" in prompt:
            return "这是一段用于联调的推荐正文，用来验证生成链路是否完整可用。内容会突出可执行的方法、可复用的思路和读完后能立即落地的行动点，同时保持自然口吻，不做营销，不做夸张承诺，让整体表达更像真实分享。读者看完后可以直接拿去实践，不需要再做复杂理解。"
        return f"MOCK_REWRITE::{prompt[:80]}"


def _extract_message_text(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("LLM response missing `choices`.")

    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        raise RuntimeError("LLM response missing `message`.")

    content = msg.get("content")
    if isinstance(content, str):
        text = content.strip()
        if not text:
            raise RuntimeError("LLM returned empty text content.")
        return text

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type in {"text", "output_text"}:
                txt = item.get("text")
                if isinstance(txt, str) and txt.strip():
                    parts.append(txt.strip())
        merged = "\n".join(parts).strip()
        if merged:
            return merged
        raise RuntimeError("LLM returned content list without text segments.")

    refusal = msg.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        raise RuntimeError(f"LLM refused request: {refusal.strip()}")

    finish_reason = choices[0].get("finish_reason") if isinstance(choices[0], dict) else None
    raise RuntimeError(
        f"LLM returned unsupported content format: {type(content).__name__}; finish_reason={finish_reason}"
    )


def build_rewrite_prompt(original_note: str, book_title: str, matched_segments: list[dict[str, Any]]) -> str:
    segment_text = "\n\n".join([f"[片段{idx+1}]\n{s['content']}" for idx, s in enumerate(matched_segments)])
    return (
        "你是小红书内容改写助手。\n"
        "请在不改变逻辑和结构的前提下，对原文进行大幅度改写。\n"
        "要求：保持段落数量、段落顺序、小标题、列表结构；只在最后3-4段自然融入书稿片段；禁止广告和购买引导。\n\n"
        f"书名：{book_title}\n\n"
        f"原文：\n{original_note}\n\n"
        f"可引用书稿片段：\n{segment_text}\n\n"
        "请直接输出改写后的完整正文。"
    )


class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def render_prompt_template(template: str, variables: dict[str, Any]) -> str:
    return template.format_map(_SafeDict(variables))


def build_intro_prompt(rewritten_note: str) -> str:
    return (
        "请根据下面正文生成一段小红书推荐正文。\n"
        "硬性要求：100-150字。\n"
        "风格自然，不要标题，不要标签，不要营销话术。\n\n"
        f"正文：\n{rewritten_note}\n\n"
        "请直接输出推荐正文。"
    )


def build_fixed_tags_prompt(rewritten_note: str) -> str:
    return (
        "请根据下面内容生成固定标签5个。\n"
        "输出格式必须是：#标签 #标签 #标签 #标签 #标签\n"
        "不要输出任何解释。\n\n"
        f"内容：\n{rewritten_note}\n"
    )


def fallback_fixed_tags(text: str, count: int = 5) -> list[str]:
    kws = extract_keywords(text, top_k=20)
    out = []
    for kw in kws:
        if kw not in out:
            out.append(kw)
        if len(out) >= count:
            break
    while len(out) < count:
        out.append(f"话题{len(out)+1}")
    return out

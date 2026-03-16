from __future__ import annotations

from docx import Document

TARGET_MIN = 300
TARGET_MAX = 800


def parse_docx_text(docx_path: str) -> list[dict[str, str]]:
    doc = Document(docx_path)
    entries: list[dict[str, str]] = []

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style_name = p.style.name.lower() if p.style and p.style.name else ""
        is_heading = "heading" in style_name
        entries.append({"text": text, "is_heading": "1" if is_heading else "0"})
    return entries


def split_long_text(text: str, max_len: int = TARGET_MAX) -> list[str]:
    if len(text) <= max_len:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_len, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


def segment_book(entries: list[dict[str, str]]) -> list[str]:
    if not entries:
        return []

    segments: list[str] = []
    buffer_parts: list[str] = []
    buffer_len = 0

    def flush_buffer() -> None:
        nonlocal buffer_parts, buffer_len
        if not buffer_parts:
            return
        joined = "\n".join(buffer_parts).strip()
        if joined:
            segments.extend(split_long_text(joined))
        buffer_parts = []
        buffer_len = 0

    for entry in entries:
        text = entry["text"]
        is_heading = entry["is_heading"] == "1"

        if is_heading and buffer_parts:
            flush_buffer()
            buffer_parts.append(text)
            buffer_len = len(text)
            continue

        if not buffer_parts:
            buffer_parts.append(text)
            buffer_len = len(text)
            continue

        candidate_len = buffer_len + 1 + len(text)
        if candidate_len > TARGET_MAX:
            flush_buffer()
            buffer_parts.append(text)
            buffer_len = len(text)
        else:
            buffer_parts.append(text)
            buffer_len = candidate_len
            if buffer_len >= TARGET_MIN and is_heading:
                flush_buffer()

    flush_buffer()
    return segments

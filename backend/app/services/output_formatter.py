from __future__ import annotations

from dataclasses import dataclass
import re

from app.models.entities import TaskType


SEPARATOR_LINE_RE = re.compile(r"^\s*[-_*─—]{3,}\s*$")
RECOMMENDATION_LABEL_RE = re.compile(r"^\s*(?:第?[一二三四五六七八九十0-9]+部分[:：]?\s*)?小红书推荐正文[:：]?\s*$")
TAG_LABEL_RE = re.compile(r"^\s*(?:第?[一二三四五六七八九十0-9]+部分[:：]?\s*)?(?:小红书)?标签[:：]?\s*$")
STRUCTURAL_SECTION_RE = re.compile(r"^\s*第?[一二三四五六七八九十0-9]+部分(?:[:：].*)?\s*$")
OUTLINE_META_RE = re.compile(r"^\s*[一二三四五六七八九十]+、.*(?:开头|中段|结尾).*$")
HASH_TAG_RE = re.compile(r"#([^\s#]+)")
BODY_STARTERS = ("说真的", "我后来发现", "很多", "你有没有发现", "听写这件事", "做管理", "团队里", "一直以为")


@dataclass
class FormattedOutput:
    full_output: str
    title_source: str
    warnings: list[str]


def _normalize_text(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return [line.strip() for line in normalized.split("\n")]


def _compact_blank_lines(lines: list[str]) -> list[str]:
    compacted: list[str] = []
    last_blank = False
    for line in lines:
        if not line:
            if last_blank:
                continue
            compacted.append("")
            last_blank = True
            continue
        compacted.append(line)
        last_blank = False
    while compacted and not compacted[0]:
        compacted.pop(0)
    while compacted and not compacted[-1]:
        compacted.pop()
    return compacted


def _is_structural_meta_line(line: str) -> bool:
    if not line:
        return False
    if RECOMMENDATION_LABEL_RE.match(line) or TAG_LABEL_RE.match(line):
        return False
    if STRUCTURAL_SECTION_RE.match(line):
        return True
    if OUTLINE_META_RE.match(line):
        return True
    return False


def _clean_lines(raw_output: str) -> list[str]:
    cleaned: list[str] = []
    for raw_line in _normalize_text(raw_output):
        if SEPARATOR_LINE_RE.match(raw_line):
            continue
        if _is_structural_meta_line(raw_line):
            continue
        cleaned.append(raw_line)
    return _compact_blank_lines(cleaned)


def _extract_tags(lines: list[str]) -> tuple[list[str], str]:
    end = len(lines) - 1
    tag_lines: list[str] = []
    collecting = False
    while end >= 0:
        line = lines[end]
        if not line:
            if collecting:
                tag_lines.append(line)
            end -= 1
            continue
        if TAG_LABEL_RE.match(line) or HASH_TAG_RE.search(line):
            collecting = True
            tag_lines.append(line)
            end -= 1
            continue
        if collecting:
            break
        end -= 1

    remaining = lines[: end + 1] if collecting else list(lines)
    tag_source = "\n".join(reversed(tag_lines))
    tags: list[str] = []
    for tag in HASH_TAG_RE.findall(tag_source):
        normalized = tag.strip().lstrip("#")
        if normalized and normalized not in tags:
            tags.append(normalized)
    return _compact_blank_lines(remaining), " ".join([f"#{tag}" for tag in tags])


def _split_intro(lines: list[str]) -> tuple[list[str], list[str]]:
    for index, line in enumerate(lines):
        if RECOMMENDATION_LABEL_RE.match(line):
            body_lines = _compact_blank_lines(lines[:index])
            intro_lines = _compact_blank_lines(lines[index + 1 :])
            return body_lines, intro_lines

    paragraphs: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                paragraphs.append(current)
                current = []
            continue
        current.append(line)
    if current:
        paragraphs.append(current)

    if len(paragraphs) <= 1:
        return _compact_blank_lines(lines), []

    body_lines: list[str] = []
    for idx, paragraph in enumerate(paragraphs[:-1]):
        if idx > 0:
            body_lines.append("")
        body_lines.extend(paragraph)
    return _compact_blank_lines(body_lines), _compact_blank_lines(paragraphs[-1])


def _leading_nonempty(lines: list[str]) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for idx, line in enumerate(lines):
        if line:
            out.append((idx, line))
        if len(out) >= 5:
            break
    return out


def _looks_like_body_line(line: str) -> bool:
    text = line.strip()
    if not text:
        return False
    if text.startswith(BODY_STARTERS):
        return True
    if re.match(r"^[一二三四五六七八九十]+、", text):
        return True
    if len(text) >= 12:
        return True
    if any(symbol in text for symbol in ("。", "！", "？", "，")):
        return True
    return False


def _looks_like_title_candidate(line: str) -> bool:
    text = line.strip()
    if not text:
        return False
    if text.startswith(BODY_STARTERS):
        return False
    if RECOMMENDATION_LABEL_RE.match(text) or TAG_LABEL_RE.match(text):
        return False
    if re.match(r"^[一二三四五六七八九十]+、", text):
        return False
    return 8 <= len(text) <= 30


def _is_complete_title(first_line: str, second_line: str | None) -> bool:
    text = first_line.strip()
    if not _looks_like_title_candidate(text):
        return False
    if second_line is None:
        return True
    return _looks_like_body_line(second_line)


def _join_title_parts(parts: list[str]) -> str:
    normalized: list[str] = []
    for part in parts:
        text = part.strip("，,。！？；; ")
        if text:
            normalized.append(text)
    if not normalized:
        return ""
    return "，".join(normalized)


def _detect_ocr_title(lines: list[str]) -> tuple[str | None, list[str], str]:
    leading = _leading_nonempty(lines)
    if not leading:
        return None, lines, "missing"

    first_index, first_line = leading[0]
    second_line = leading[1][1] if len(leading) > 1 else None
    if _is_complete_title(first_line, second_line):
        remaining = list(lines)
        remaining[first_index] = ""
        return first_line.strip(), _compact_blank_lines(remaining), "single_line"

    for count in (3, 2):
        if len(leading) < count + 1:
            continue
        parts = [leading[idx][1] for idx in range(count)]
        if not all(2 <= len(part.strip()) <= 12 for part in parts):
            continue
        candidate = _join_title_parts(parts)
        if len(candidate) < 8 or len(candidate) > 30:
            continue
        next_line = leading[count][1]
        if not _looks_like_body_line(next_line):
            continue
        remaining = list(lines)
        for idx, _ in leading[:count]:
            remaining[idx] = ""
        return candidate, _compact_blank_lines(remaining), "multi_line"

    if _is_complete_title(first_line, None):
        remaining = list(lines)
        remaining[first_index] = ""
        return first_line.strip(), _compact_blank_lines(remaining), "single_line"

    return None, lines, "missing"


def _remove_duplicate_leading_title(lines: list[str], title: str) -> list[str]:
    if not title:
        return lines
    for index, line in enumerate(lines):
        if not line:
            continue
        if line.strip() == title.strip():
            remaining = list(lines)
            remaining[index] = ""
            return _compact_blank_lines(remaining)
        break
    return lines


def _collapse_text(lines: list[str]) -> str:
    return "\n".join(_compact_blank_lines(lines)).strip()


def format_generated_output(
    *,
    task_type: TaskType,
    raw_output: str,
    task_title: str | None = None,
    extracted_title: str | None = None,
) -> FormattedOutput:
    warnings: list[str] = []
    cleaned_lines = _clean_lines(raw_output)
    body_and_intro_lines, tag_line = _extract_tags(cleaned_lines)
    body_lines, intro_lines = _split_intro(body_and_intro_lines)

    title_source = "generated"
    title = ""
    if task_type == TaskType.create:
        leading = _leading_nonempty(body_lines)
        first_line = leading[0][1] if leading else ""
        second_line = leading[1][1] if len(leading) > 1 else None
        if first_line and (_is_complete_title(first_line, second_line) or _looks_like_title_candidate(first_line)):
            title = first_line.strip()
            title_source = "generated"
            body_lines = _remove_duplicate_leading_title(body_lines, title)
        else:
            title = (task_title or "").strip()
            title_source = "task_title"
            body_lines = _remove_duplicate_leading_title(body_lines, title)
    elif task_type == TaskType.framework:
        title = (extracted_title or task_title or "").strip()
        title_source = "extracted_title" if extracted_title else "task_title"
        body_lines = _remove_duplicate_leading_title(body_lines, title)
    else:
        detected_title, remaining_body_lines, detected_source = _detect_ocr_title(body_lines)
        if detected_title:
            title = detected_title
            body_lines = remaining_body_lines
            title_source = detected_source
        else:
            title = (task_title or "").strip()
            if title:
                title_source = "task_title"

    if not title:
        warnings.append("missing_title")
        first_line = next((line for line in body_lines if line), "")
        if first_line:
            title = first_line[:255]
            body_lines = _remove_duplicate_leading_title(body_lines, title)
            title_source = "body_fallback"

    if not intro_lines:
        warnings.append("missing_intro")

    if not tag_line:
        warnings.append("missing_tags")

    body_text = _collapse_text(body_lines)
    intro_text = _collapse_text(intro_lines)
    sections = [title.strip()]
    if body_text:
        sections.append(body_text)
    sections.append(f"小红书推荐正文：\n{intro_text}".strip())
    if tag_line:
        sections.append(tag_line)
    full_output = "\n\n".join([section for section in sections if section]).strip()
    return FormattedOutput(full_output=full_output, title_source=title_source, warnings=warnings)

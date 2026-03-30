from __future__ import annotations

import multiprocessing as mp
import platform
import sys
from pathlib import Path
from typing import Optional

from app.core.config import settings


class OCRService:
    def __init__(self, provider: Optional[str] = None, lang: Optional[str] = None) -> None:
        self.configured_provider = (provider or settings.ocr_provider).lower().strip()
        provider_aliases = {
            "rapidocr": "rapidocr_onnxruntime",
            "rapid_ocr": "rapidocr_onnxruntime",
            "rapidocr-onnxruntime": "rapidocr_onnxruntime",
        }
        self.provider = provider_aliases.get(self.configured_provider, self.configured_provider)
        self.lang = (lang or settings.ocr_lang).strip()
        self.downgrade_reason: Optional[str] = None
        self._engine = None

        if (
            self.configured_provider == "paddleocr"
            and platform.system() == "Darwin"
            and settings.ocr_auto_downgrade_macos
            and not settings.ocr_allow_unstable_runtime
        ):
            self.provider = "mock"
            self.downgrade_reason = (
                "Detected macOS runtime. Auto-downgraded OCR provider from paddleocr to mock "
                "to avoid Paddle native crash (SIGSEGV)."
            )

    def _init_paddle(self) -> None:
        if self._engine is not None:
            return
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "PaddleOCR is not available. Install dependencies or use OCR_PROVIDER=mock."
            ) from exc

        self._engine = PaddleOCR(
            lang=self.lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def _extract_with_paddle(self, image_path: Path) -> str:
        self._init_paddle()
        result = self._engine.predict(str(image_path))

        lines = []
        for page in result or []:
            rec_texts = page.get("rec_texts", []) if isinstance(page, dict) else []
            for text in rec_texts:
                if text is not None:
                    lines.append(str(text))
        return "\n".join(lines)

    def _extract_with_mock(self, image_path: Path) -> str:
        return f"[MOCK_OCR]{image_path.name}"

    def _init_rapidocr(self) -> None:
        if self._engine is not None:
            return
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "rapidocr_onnxruntime is not available. Install dependencies or use OCR_PROVIDER=mock."
            ) from exc
        self._engine = RapidOCR()

    def _extract_with_rapidocr(self, image_path: Path) -> str:
        self._init_rapidocr()
        result = self._engine(str(image_path))
        # Compatible with different rapidocr versions:
        # - (ocr_result, elapsed)
        # - ocr_result
        ocr_result = result[0] if isinstance(result, tuple) else result
        lines = []
        for row in ocr_result or []:
            if not row:
                continue
            # expected row: [box, text, score]
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                text = row[1]
            else:
                text = row
            if text is not None:
                lines.append(str(text))
        return "\n".join(lines)

    def extract_text(self, image_path: Path) -> str:
        if not image_path.exists():
            raise RuntimeError(f"Image not found: {image_path}")

        if self.provider == "mock":
            return self._extract_with_mock(image_path)
        if self.provider == "rapidocr_onnxruntime":
            return self._extract_with_rapidocr(image_path)
        if self.provider == "paddleocr":
            return self._extract_with_paddle(image_path)
        raise RuntimeError(f"Unsupported OCR provider: {self.provider}")


_ocr_service: Optional[OCRService] = None


def get_ocr_service() -> OCRService:
    global _ocr_service
    if _ocr_service is None:
        _ocr_service = OCRService()
    return _ocr_service


def _ocr_extract_child(provider: str, lang: str, image_path: str, out_queue) -> None:
    try:
        service = OCRService(provider=provider, lang=lang)
        text = service.extract_text(Path(image_path))
        out_queue.put({"ok": True, "text": text})
    except Exception as exc:
        out_queue.put({"ok": False, "error": f"{exc.__class__.__name__}: {exc}"})


def extract_text_with_timeout(image_path: Path, timeout_seconds: Optional[int] = None) -> str:
    service = get_ocr_service()
    timeout = timeout_seconds if timeout_seconds is not None else settings.ocr_timeout_seconds

    if (
        service.provider == "paddleocr"
        and platform.system() == "Darwin"
        and not settings.ocr_auto_downgrade_macos
        and not settings.ocr_allow_unstable_runtime
    ):
        raise RuntimeError(
            "PaddleOCR is blocked on macOS by runtime guard (SIGSEGV risk). "
            "Enable OCR_AUTO_DOWNGRADE_MACOS=true or use OCR_PROVIDER=mock. "
            "You can override by setting OCR_ALLOW_UNSTABLE_RUNTIME=true."
        )

    if service.provider != "paddleocr" or not settings.ocr_isolate_subprocess:
        return service.extract_text(image_path)
    if timeout <= 0:
        return service.extract_text(image_path)

    ctx = mp.get_context("spawn")
    out_queue = ctx.Queue(maxsize=1)
    proc = ctx.Process(
        target=_ocr_extract_child,
        args=(service.provider, service.lang, str(image_path), out_queue),
        daemon=True,
    )
    proc.start()
    proc.join(timeout=timeout)

    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=2)
        raise RuntimeError(f"OCR timed out after {timeout}s on `{image_path.name}`")

    payload = None
    try:
        payload = out_queue.get_nowait()
    except Exception:
        payload = None

    if not payload:
        if proc.exitcode not in (0, None):
            raise RuntimeError(
                f"OCR subprocess exited abnormally (exitcode={proc.exitcode}) on `{image_path.name}`"
            )
        raise RuntimeError(f"OCR subprocess returned no result on `{image_path.name}`")

    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or f"OCR subprocess failed on `{image_path.name}`"))

    return str(payload.get("text") or "")

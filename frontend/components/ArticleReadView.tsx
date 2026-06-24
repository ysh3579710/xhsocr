"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ArticleColumnMode = "auto" | "2-column" | "3-column";

const AUTO_THREE_COLUMN_THRESHOLD = 1800;
const MIN_THREE_COLUMN_WIDTH = 1080;

function getEffectiveColumnCount(mode: ArticleColumnMode, text: string, width: number | null): 2 | 3 {
  const contentLength = text.replace(/\s+/g, "").length;
  const autoCount: 2 | 3 = contentLength >= AUTO_THREE_COLUMN_THRESHOLD ? 3 : 2;
  const targetCount: 2 | 3 = mode === "auto" ? autoCount : mode === "3-column" ? 3 : 2;

  if (targetCount === 3 && width !== null && width < MIN_THREE_COLUMN_WIDTH) {
    return 2;
  }
  return targetCount;
}

function splitArticleParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  return normalized.split(/\n/);
}

type Props = {
  text: string;
  mode: ArticleColumnMode;
  onModeChange: (mode: ArticleColumnMode) => void;
};

export default function ArticleReadView({ text, mode, onModeChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      setContainerWidth(node.clientWidth || null);
    };

    updateWidth();
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const effectiveColumns = useMemo(
    () => getEffectiveColumnCount(mode, text, containerWidth),
    [containerWidth, mode, text]
  );
  const paragraphs = useMemo(() => splitArticleParagraphs(text), [text]);

  return (
    <div className="readingSurface" ref={containerRef}>
      <div className="articleToolbar">
        <p className="readingMeta">
          阅读态默认按最终文本自动切换 2 栏或 3 栏，长文优先 3 栏展示。
          {mode === "auto" ? ` 当前自动结果：${effectiveColumns}栏` : ` 当前手动结果：${effectiveColumns}栏`}
        </p>
        <div className="columnModeGroup" role="group" aria-label="正文栏数">
          <button
            type="button"
            className={`modeBtn ${mode === "auto" ? "active" : ""}`}
            onClick={() => onModeChange("auto")}
          >
            自动
          </button>
          <button
            type="button"
            className={`modeBtn ${mode === "2-column" ? "active" : ""}`}
            onClick={() => onModeChange("2-column")}
          >
            2栏
          </button>
          <button
            type="button"
            className={`modeBtn ${mode === "3-column" ? "active" : ""}`}
            onClick={() => onModeChange("3-column")}
          >
            3栏
          </button>
        </div>
      </div>

      {paragraphs.length ? (
        <div className={`articleColumns columns${effectiveColumns}`}>
          {paragraphs.map((paragraph, index) =>
            paragraph.trim() ? (
              <p key={`${index}-${paragraph.slice(0, 12)}`} className="articleParagraph">
                {paragraph}
              </p>
            ) : (
              <div key={`spacer-${index}`} className="articleParagraphSpacer" aria-hidden="true" />
            )
          )}
        </div>
      ) : (
        <p className="articleEmpty">暂无内容</p>
      )}
    </div>
  );
}

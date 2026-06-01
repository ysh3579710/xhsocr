type PaginationControlsProps = {
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  disabled?: boolean;
  onChange: (page: number) => void;
};

export function PaginationControls({
  page,
  totalPages,
  total,
  pageSize = 50,
  disabled = false,
  onChange,
}: PaginationControlsProps) {
  const canPrev = !disabled && page > 1;
  const canNext = !disabled && page < totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <div className="paginationRow">
      <div className="paginationMeta">
        共 {total} 条，第 {page} / {totalPages} 页{total > 0 ? `，当前显示 ${from}-${to}` : ""}
      </div>
      <div className="paginationActions">
        <button type="button" onClick={() => onChange(page - 1)} disabled={!canPrev}>
          上一页
        </button>
        <button type="button" onClick={() => onChange(page + 1)} disabled={!canNext}>
          下一页
        </button>
      </div>
    </div>
  );
}

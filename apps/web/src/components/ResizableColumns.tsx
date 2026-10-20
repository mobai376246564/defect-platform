import type { ThHTMLAttributes } from 'react';
import { useCallback, useRef, useState } from 'react';

const MIN_WIDTH = 60;

function readWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * 可拖动的列宽：返回每列当前宽度与设置方法。拖动结束后写入 localStorage，下次打开保持；
 * 双击分隔线恢复默认宽度。
 */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const [custom, setCustom] = useState<Record<string, number>>(() => readWidths(storageKey));
  // 拖动过程中同步记下最新宽度，松开鼠标时直接保存它
  const latest = useRef(custom);

  const update = (next: Record<string, number>) => {
    latest.current = next;
    setCustom(next);
  };
  const save = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(latest.current));
    } catch {
      // 只是记住偏好
    }
  }, [storageKey]);

  const widthOf = (key: string) => custom[key] ?? defaults[key] ?? 120;
  const resize = (key: string, width: number) =>
    update({ ...latest.current, [key]: Math.max(MIN_WIDTH, Math.round(width)) });
  const reset = (key: string) => {
    const next = { ...latest.current };
    delete next[key];
    update(next);
    save();
  };
  /** 交给 column.onHeaderCell 的属性 */
  const headerProps = (key: string) =>
    ({
      onResize: (w: number) => resize(key, w),
      onResizeEnd: save,
      onResetWidth: () => reset(key),
    }) as ThHTMLAttributes<HTMLTableCellElement>;
  return { widthOf, headerProps };
}

/** 表头单元格：右侧带一条可拖动的分隔线 */
export function ResizableHeaderCell({
  onResize,
  onResizeEnd,
  onResetWidth,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & {
  onResize?: (width: number) => void;
  onResizeEnd?: () => void;
  onResetWidth?: () => void;
}) {
  if (!onResize) return <th {...rest}>{children}</th>;
  const start = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement!;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => onResize(startWidth + ev.clientX - startX);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('col-resizing');
      onResizeEnd?.();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.classList.add('col-resizing');
  };
  return (
    <th {...rest}>
      {children}
      <span
        className="col-resize-handle"
        title="拖动调整列宽，双击恢复默认"
        onMouseDown={start}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onResetWidth?.();
        }}
      />
    </th>
  );
}

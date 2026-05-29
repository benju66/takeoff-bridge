import React from "react";

// ---------------------------------------------------------------------------
// ResizeHandle — Column resize drag handle for TanStack Table
// ---------------------------------------------------------------------------

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  isResizing: boolean;
}

export function ResizeHandle({
  onMouseDown,
  onTouchStart,
  isResizing,
}: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-opacity ${
        isResizing
          ? "bg-blue-600 dark:bg-blue-400 opacity-100 w-1.5"
          : "bg-grid-border opacity-0 group-hover/header:opacity-100"
      }`}
    />
  );
}

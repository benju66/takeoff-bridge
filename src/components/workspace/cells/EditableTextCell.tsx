"use client";

import React, { useRef, memo } from 'react';

interface EditableTextCellProps {
  rowId: string;
  value: string;
  field: string;
  isCellLocked: boolean;
  inputId: string;
  rowIndex: number;
  className?: string;
  placeholder?: string;
  datalistId?: string;
  showSuggestions?: boolean;
  suggestions?: Array<{ code: string; description: string; score: number }>;
  isMapped?: boolean;
  onEdit: (index: number, field: string, value: string) => void;
  onCommit: (rowId: string, field: string, prevValue: string, nextValue: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onSuggestionClick?: (code: string) => void;
}

function EditableTextCellInner({
  rowId,
  value,
  field,
  isCellLocked,
  inputId,
  rowIndex,
  className,
  placeholder,
  datalistId,
  showSuggestions,
  suggestions,
  isMapped,
  onEdit,
  onCommit,
  onKeyDown,
  onPaste,
  onContextMenu,
  onSuggestionClick,
}: EditableTextCellProps) {
  const initialValueRef = useRef<string>(value);

  const handleFocus = () => {
    initialValueRef.current = value;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onEdit(rowIndex, field, e.target.value);
  };

  const handleBlur = () => {
    if (value !== initialValueRef.current) {
      onCommit(rowId, field, initialValueRef.current, value);
    }
  };

  const lockedClass = isCellLocked ? 'opacity-60 cursor-not-allowed' : '';

  return (
    <div className="relative w-full h-full" onContextMenu={onContextMenu}>
      <input
        id={inputId}
        type="text"
        value={value}
        disabled={isCellLocked}
        placeholder={placeholder}
        list={datalistId}
        className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${lockedClass} ${className ?? ''}`}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {showSuggestions && suggestions && suggestions.length > 0 && !isMapped && (
        <div className="absolute left-0 top-full z-20 flex flex-wrap gap-1 p-1 bg-white dark:bg-slate-800 shadow-md rounded-b border border-t-0 border-gray-200 dark:border-slate-700">
          {suggestions.map((s) => (
            <span
              key={s.code}
              className="text-[10px] bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60"
              onClick={() => onSuggestionClick?.(s.code)}
              title={s.description}
            >
              {s.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function areEqual(prev: EditableTextCellProps, next: EditableTextCellProps): boolean {
  return (
    prev.value === next.value &&
    prev.isCellLocked === next.isCellLocked &&
    prev.field === next.field &&
    (prev.suggestions?.length ?? 0) === (next.suggestions?.length ?? 0)
  );
}

const EditableTextCell = memo(EditableTextCellInner, areEqual);

export default EditableTextCell;
export type { EditableTextCellProps };

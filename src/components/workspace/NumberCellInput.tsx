"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// NumberCellInput — Self-contained numeric cell with local string buffer
//
// Solves the controlled-input focus-loss problem by keeping the editing buffer
// as LOCAL component state.  When the cell is focused the user sees and edits
// the raw string; when blurred the component commits the parsed number via
// onCommit and the parent row value (passed in via `value`) is displayed.
//
// Because the buffer lives inside this component (not in TanStack meta or a
// parent hook), typing never triggers a parent re-render, which eliminates
// the DOM unmount / focus-loss cascade that occurred with the previous
// meta-based buffer approach.
// ---------------------------------------------------------------------------

interface NumberCellInputProps {
  id: string;
  value: number;
  disabled?: boolean;
  className?: string;
  /** Called on blur with the final numeric value if it changed. */
  onCommit: (newValue: number) => void;
  /** Called on every keystroke (e.g. for live totals preview). */
  onLiveChange?: (newValue: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLInputElement>) => void;
}

export const NumberCellInput = React.memo(function NumberCellInput({
  id,
  value,
  disabled = false,
  className = "",
  onCommit,
  onLiveChange,
  onKeyDown,
  onPaste,
  onContextMenu,
}: NumberCellInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [buffer, setBuffer] = useState("");
  const initialValueRef = useRef(value);

  // Sync the display value when the parent's value changes (e.g. undo/redo,
  // cascade from sibling edits, external data reload).
  // Only update when NOT editing to avoid clobbering the user's in-progress input.
  useEffect(() => {
    if (!isEditing) {
      initialValueRef.current = value;
    }
  }, [value, isEditing]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setIsEditing(true);
    setBuffer(String(value));
    initialValueRef.current = value;
    // Select all text so the user can type-to-replace
    e.currentTarget.select();
  }, [value]);

  const handleBlur = useCallback(() => {
    const parsed = parseFloat(buffer);
    const numVal = isNaN(parsed) ? 0 : parsed;
    setIsEditing(false);
    if (numVal !== initialValueRef.current) {
      onCommit(numVal);
    }
  }, [buffer, onCommit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setBuffer(raw);
    // Optionally update live totals
    if (onLiveChange) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) onLiveChange(parsed);
    }
  }, [onLiveChange]);

  // Display value: when editing show the raw buffer; otherwise show the numeric value
  const displayValue = isEditing ? buffer : value;

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      disabled={disabled}
      className={className}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
    />
  );
});

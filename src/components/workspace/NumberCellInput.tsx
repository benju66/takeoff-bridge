"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { evaluateMathExpression } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// NumberCellInput — Self-contained numeric cell with local string buffer
// Upgraded for Strategy A: Excel Reversion (Escape cancels edit)
// ---------------------------------------------------------------------------

interface NumberCellInputProps {
  id: string;
  value: number;
  disabled?: boolean;
  className?: string;
  /** Called on blur with the final numeric value if it changed. */
  onCommit: (newValue: number) => void;
  /**
   * Opt-in: called on blur when the buffer is empty, instead of coercing to 0. Lets a cell
   * distinguish "blank" from a real 0 (the Buyout Actual cell: blank reads as the Estimate,
   * L-3). Number cells that omit this keep the legacy empty→0 behavior (qty/price).
   */
  onCommitEmpty?: () => void;
  /** Called on every keystroke (e.g. for live totals preview). */
  onLiveChange?: (newValue: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLInputElement>) => void;
  initialEditChar?: string | null;
}

export const NumberCellInput = React.memo(function NumberCellInput({
  id,
  value,
  disabled = false,
  className = "",
  onCommit,
  onCommitEmpty,
  onLiveChange,
  onKeyDown,
  onPaste,
  onContextMenu,
  initialEditChar,
}: NumberCellInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [buffer, setBuffer] = useState("");
  const initialValueRef = useRef(value);
  const isRevertedRef = useRef(false);

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
    initialValueRef.current = value;
    isRevertedRef.current = false;
    
    if (initialEditChar !== undefined && initialEditChar !== null) {
      setBuffer(initialEditChar);
    } else {
      setBuffer(String(value));
      // Select all text so the user can type-to-replace
      e.currentTarget.select();
    }
  }, [value, initialEditChar]);

  const handleBlur = useCallback(() => {
    if (isRevertedRef.current) {
      isRevertedRef.current = false;
      setIsEditing(false);
      return;
    }
    const trimmed = buffer.trim();
    // Opt-in (onCommitEmpty): an empty buffer clears to "no value" rather than 0 — so a
    // Buyout Actual the user blanks out reads as the Estimate (L-3), not a $0 commit. Cells
    // without the callback keep the legacy empty→0 path below.
    if (trimmed === "" && onCommitEmpty) {
      setIsEditing(false);
      onCommitEmpty();
      return;
    }
    let numVal: number;
    if (trimmed.startsWith("=") || /[+\-*/]/.test(trimmed)) {
      numVal = evaluateMathExpression(trimmed);
    } else {
      numVal = parseFloat(trimmed);
    }
    const finalVal = isNaN(numVal) ? 0 : numVal;
    setIsEditing(false);
    if (finalVal !== initialValueRef.current) {
      onCommit(finalVal);
    }
  }, [buffer, onCommit, onCommitEmpty]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setBuffer(raw);
    // Optionally update live totals
    if (onLiveChange) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) onLiveChange(parsed);
    }
  }, [onLiveChange]);

  const handleKeyDownInternal = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      isRevertedRef.current = true;
      setBuffer(String(initialValueRef.current));
      setIsEditing(false);
      e.currentTarget.blur();
    }
    if (onKeyDown) {
      onKeyDown(e);
    }
  }, [onKeyDown]);

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
      onKeyDown={handleKeyDownInternal}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
      autoFocus
    />
  );
});

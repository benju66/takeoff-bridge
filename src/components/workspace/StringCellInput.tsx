"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// StringCellInput — Excel-grade buffered text editor
// Localizes cursor focus and state, deferring commits until blur/Enter.
// ---------------------------------------------------------------------------

interface StringCellInputProps {
  id: string;
  value: string;
  disabled?: boolean;
  className?: string;
  onCommit: (newValue: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLInputElement>) => void;
  list?: string;
  initialEditChar?: string | null;
}

export const StringCellInput = React.memo(function StringCellInput({
  id,
  value,
  disabled = false,
  className = "",
  onCommit,
  onKeyDown,
  onPaste,
  onContextMenu,
  list,
  initialEditChar,
}: StringCellInputProps) {
  // Initialize with initialEditChar if direct alphanumeric typing triggered this editor
  const [buffer, setBuffer] = useState(
    initialEditChar !== undefined && initialEditChar !== null ? initialEditChar : value
  );
  const initialValueRef = useRef(value);
  const isRevertedRef = useRef(false);

  // Sync state if external change happens (e.g. undo/redo) and we are not focused
  useEffect(() => {
    if (document.activeElement?.id !== id) {
      setBuffer(value);
      initialValueRef.current = value;
    }
  }, [value, id]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    initialValueRef.current = value;
    isRevertedRef.current = false;
    
    // Select all text if editing was not triggered by direct typing
    if (initialEditChar === undefined || initialEditChar === null) {
      setBuffer(value);
      e.currentTarget.select();
    }
  }, [value, initialEditChar]);

  const handleBlur = useCallback(() => {
    if (isRevertedRef.current) {
      isRevertedRef.current = false;
      return;
    }
    if (buffer !== initialValueRef.current) {
      onCommit(buffer);
    }
  }, [buffer, onCommit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBuffer(e.target.value);
  }, []);

  const handleKeyDownInternal = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      isRevertedRef.current = true;
      setBuffer(initialValueRef.current);
      e.currentTarget.blur();
    }
    if (onKeyDown) {
      onKeyDown(e);
    }
  }, [onKeyDown]);

  return (
    <input
      id={id}
      type="text"
      disabled={disabled}
      className={className}
      value={buffer}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDownInternal}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
      list={list}
      autoFocus
    />
  );
});

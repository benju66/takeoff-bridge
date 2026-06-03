"use client";

import React, { useRef, useEffect, useCallback } from "react";
import { UOM_OPTIONS, UOM_GROUPS } from "@/lib/uom-options";

// ---------------------------------------------------------------------------
// SelectCellInput — Inline <select> cell editor for UOM dropdown
//
// Unlike NumberCellInput/StringCellInput, this commits IMMEDIATELY on change
// (no blur buffer). The select opens on mount via autoFocus.
// Escape reverts to the original value and exits edit mode.
// ---------------------------------------------------------------------------

interface SelectCellInputProps {
  id: string;
  value: string;
  disabled?: boolean;
  className?: string;
  /** Called immediately when user picks a new option. */
  onCommit: (newValue: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLSelectElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLSelectElement>) => void;
}

export const SelectCellInput = React.memo(function SelectCellInput({
  id,
  value,
  disabled = false,
  className = "",
  onCommit,
  onKeyDown,
  onContextMenu,
}: SelectCellInputProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const initialValueRef = useRef(value);

  useEffect(() => {
    // Focus on mount so keyboard navigation works immediately
    selectRef.current?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = e.target.value;
      if (newValue !== initialValueRef.current) {
        onCommit(newValue);
      }
    },
    [onCommit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSelectElement>) => {
      if (e.key === "Escape") {
        // Revert — no commit
        e.currentTarget.blur();
      }
      if (onKeyDown) {
        onKeyDown(e);
      }
    },
    [onKeyDown],
  );

  return (
    <select
      ref={selectRef}
      id={id}
      disabled={disabled}
      className={className}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      autoFocus
    >
      {UOM_GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {UOM_OPTIONS.filter((o) => o.group === group).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
});

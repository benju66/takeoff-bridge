"use client";

import React, { useState, useRef, useCallback, memo } from "react";
import { ProcessedTakeoffRow } from "@/types";

interface EditableNumberCellProps {
  rowId: string;
  value: number;
  field: "matchedQty" | "unitPrice";
  isCellLocked: boolean;
  isCurrency: boolean;
  decimalPlaces: number;
  inputId: string;
  rowIndex: number;
  onEdit: (
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number
  ) => void;
  onCommit: (
    rowId: string,
    field: keyof ProcessedTakeoffRow,
    prevValue: string | number | boolean,
    nextValue: string | number | boolean
  ) => void;
  onKeyDown: (
    e: React.KeyboardEvent,
    rIdx: number,
    type: "code" | "desc" | "qty" | "price"
  ) => void;
  onPaste: (
    e: React.ClipboardEvent<HTMLInputElement>,
    startRowIdx: number,
    type: "code" | "desc" | "qty" | "price"
  ) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function EditableNumberCellInner({
  rowId,
  value,
  field,
  isCellLocked,
  isCurrency,
  decimalPlaces,
  inputId,
  rowIndex,
  onEdit,
  onCommit,
  onKeyDown,
  onPaste,
  onContextMenu,
}: EditableNumberCellProps) {
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const initialValueRef = useRef<number>(value);

  const keyType = field === "matchedQty" ? "qty" : "price";
  const pasteType = field === "matchedQty" ? "qty" : "price";

  const formatDisplay = useCallback(
    (v: number): string => {
      const formatted = v.toLocaleString(undefined, {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      });
      return isCurrency ? `$${formatted}` : formatted;
    },
    [decimalPlaces, isCurrency]
  );

  const handleFocus = useCallback(() => {
    initialValueRef.current = value;
    setEditBuffer(String(value));
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditBuffer(e.target.value);
    },
    []
  );

  const handleBlur = useCallback(() => {
    const numVal = parseFloat(editBuffer ?? "") || 0;
    onEdit(rowIndex, field, numVal);
    if (numVal !== initialValueRef.current) {
      onCommit(rowId, field, initialValueRef.current, numVal);
    }
    setEditBuffer(null);
  }, [editBuffer, rowIndex, field, rowId, onEdit, onCommit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      onKeyDown(e, rowIndex, keyType);
    },
    [onKeyDown, rowIndex, keyType]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      onPaste(e, rowIndex, pasteType);
    },
    [onPaste, rowIndex, pasteType]
  );

  const displayValue =
    editBuffer !== null ? editBuffer : formatDisplay(value);

  return (
    <input
      id={inputId}
      type="text"
      inputMode="decimal"
      value={displayValue}
      readOnly={isCellLocked}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onContextMenu={onContextMenu}
      className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40${
        isCellLocked ? " opacity-60 cursor-not-allowed" : ""
      }`}
    />
  );
}

function areEqual(
  prev: EditableNumberCellProps,
  next: EditableNumberCellProps
): boolean {
  return (
    prev.value === next.value &&
    prev.isCellLocked === next.isCellLocked &&
    prev.decimalPlaces === next.decimalPlaces &&
    prev.isCurrency === next.isCurrency
  );
}

const EditableNumberCell = memo(EditableNumberCellInner, areEqual);
EditableNumberCell.displayName = "EditableNumberCell";

export default EditableNumberCell;

"use client";

import React, { memo } from "react";

interface ReadOnlyCellProps {
  value: string | number;
  format: "badge" | "currency" | "text";
  className?: string;
  decimalPlaces?: number;
}

function ReadOnlyCellInner({
  value,
  format,
  className = "",
  decimalPlaces = 2,
}: ReadOnlyCellProps) {
  let displayContent: string;

  switch (format) {
    case "currency": {
      const numVal = Number(value);
      const formatted = numVal.toLocaleString(undefined, {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      });
      displayContent = `$${formatted}`;
      break;
    }
    case "badge":
      displayContent = String(value).toUpperCase();
      break;
    case "text":
    default:
      displayContent = String(value);
      break;
  }

  const baseClasses =
    "w-full h-full min-h-[36px] px-3 py-2 bg-transparent text-center text-xs font-mono flex items-center justify-center";

  const formatClasses = format === "badge" ? " font-bold uppercase" : "";

  return (
    <div className={`${baseClasses}${formatClasses} ${className}`.trim()}>
      {displayContent}
    </div>
  );
}

function areEqual(
  prev: ReadOnlyCellProps,
  next: ReadOnlyCellProps
): boolean {
  return (
    prev.value === next.value &&
    prev.format === next.format &&
    prev.className === next.className &&
    prev.decimalPlaces === next.decimalPlaces
  );
}

const ReadOnlyCell = memo(ReadOnlyCellInner, areEqual);
ReadOnlyCell.displayName = "ReadOnlyCell";

export default ReadOnlyCell;

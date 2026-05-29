import React from "react";

// ---------------------------------------------------------------------------
// GridCellCurrency — Read-only formatted currency display cell
// ---------------------------------------------------------------------------

interface GridCellCurrencyProps {
  value: number;
  /** Use emerald color for positive values (default: true) */
  positive?: boolean;
  /** Apply font-black instead of font-bold */
  bold?: boolean;
  /** Additional className for the container */
  className?: string;
}

export function GridCellCurrency({
  value,
  positive = true,
  bold = true,
  className = "",
}: GridCellCurrencyProps) {
  const colorClass =
    positive && value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-600 dark:text-slate-400";

  const weightClass = bold ? "font-bold" : "font-semibold";

  return (
    <div className={`text-center ${weightClass} font-mono ${className}`}>
      <span className={colorClass}>
        ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

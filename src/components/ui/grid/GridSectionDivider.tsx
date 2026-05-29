import React from "react";

// ---------------------------------------------------------------------------
// GridSectionDivider — Subsection header rows used for "01.A", "02.A", division headers
// ---------------------------------------------------------------------------

interface GridSectionDividerProps {
  label: string;
  colSpan: number;
  /** "blue" = step 2/3 subsection headers, "branded" = step 4 division headers */
  variant?: "blue" | "branded";
}

export function GridSectionDivider({
  label,
  colSpan,
  variant = "blue",
}: GridSectionDividerProps) {
  if (variant === "branded") {
    return (
      <tr className="bg-[#3057A6] border-y border-grid-border font-sans select-none">
        <td
          colSpan={colSpan}
          className="p-3 border-r border-b border-grid-border text-left font-bold text-white uppercase tracking-wider text-[13px]"
        >
          {label}
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
      <td
        colSpan={colSpan}
        className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold"
      >
        {label}
      </td>
    </tr>
  );
}

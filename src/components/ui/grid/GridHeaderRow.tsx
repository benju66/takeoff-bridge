import React from "react";

// ---------------------------------------------------------------------------
// GridHeaderRow — Standard header <tr> with bg-[#3057A6] styling
// ---------------------------------------------------------------------------

export interface GridColumn {
  label: string;
  width?: string;       // Tailwind width class, e.g., "w-28", "w-44"
  align?: "left" | "center" | "right";
}

interface GridHeaderRowProps {
  columns: GridColumn[];
}

const alignMap = { left: "text-left", center: "text-center", right: "text-right" };

export function GridHeaderRow({ columns }: GridHeaderRowProps) {
  return (
    <tr className="bg-[#3057A6] text-white uppercase tracking-wider font-bold text-[13px]">
      {columns.map((col, idx) => (
        <th
          key={`${col.label}-${idx}`}
          className={`p-4 ${alignMap[col.align ?? "center"]} ${col.width ?? ""} ${
            idx < columns.length - 1
              ? "border-r border-b border-grid-border"
              : "border-b border-grid-border"
          } font-bold sticky top-0 z-10 bg-[#3057A6]`}
        >
          {col.label}
        </th>
      ))}
    </tr>
  );
}

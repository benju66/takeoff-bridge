"use client";

import React, { memo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// SortableColumnHeader — Click-to-sort column header with direction indicator
// Cycles: none → asc → desc → none
// ---------------------------------------------------------------------------

interface SortableColumnHeaderProps {
  column: Column<ProcessedTakeoffRow, unknown>;
  label: React.ReactNode;
  className?: string;
}

function SortableColumnHeaderInner({ column, label, className = "" }: SortableColumnHeaderProps) {
  const sortDir = column.getIsSorted();
  const canSort = column.getCanSort();

  return (
    <button
      type="button"
      className={`flex items-center gap-1 w-full justify-center select-none ${canSort ? "cursor-pointer hover:opacity-80" : "cursor-default"} ${className}`}
      onClick={canSort ? column.getToggleSortingHandler() : undefined}
      title={canSort ? (sortDir === "asc" ? "Sort descending" : sortDir === "desc" ? "Clear sort" : "Sort ascending") : undefined}
    >
      <span className="truncate">{label}</span>
      {canSort && (
        <span className="inline-flex flex-col leading-none ml-0.5" style={{ fontSize: "8px" }}>
          <ChevronUp
            size={10}
            className={`transition-opacity ${sortDir === "asc" ? "opacity-100 text-white" : "opacity-30"}`}
          />
          <ChevronDown
            size={10}
            className={`-mt-1 transition-opacity ${sortDir === "desc" ? "opacity-100 text-white" : "opacity-30"}`}
          />
        </span>
      )}
    </button>
  );
}

export const SortableColumnHeader = memo(SortableColumnHeaderInner);

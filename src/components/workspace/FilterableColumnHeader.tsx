"use client";

import React, { memo, useMemo, useState } from "react";
import { ListFilter } from "lucide-react";
import type { Column, Table } from "@tanstack/react-table";
import { ProcessedTakeoffRow } from "@/types";

interface FilterableColumnHeaderProps {
  column: Column<ProcessedTakeoffRow, unknown>;
  table: Table<ProcessedTakeoffRow>;
  label: React.ReactNode;
  className?: string;
}

function FilterableColumnHeaderInner({ column, table, label, className = "" }: FilterableColumnHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const activeFilterValue = (column.getFilterValue() as string[]) || [];

  // Compute unique non-empty values across the entire dataset
  const uniqueValues = useMemo(() => {
    const set = new Set<string>();
    table.getCoreRowModel().rows.forEach((row) => {
      const val = row.getValue(column.id);
      if (val !== undefined && val !== null && val !== "") {
        set.add(String(val));
      }
    });
    return Array.from(set).sort((a, b) => {
      const numA = Number(a);
      const numB = Number(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
  }, [column.id, table]);

  // Premium value formatter based on column ID
  const formatValue = React.useCallback((val: string) => {
    const num = Number(val);
    if (isNaN(num)) return val;
    
    if (["unitPrice", "total", "costPerUnit", "costPerSf"].includes(column.id)) {
      return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
    }
    if (column.id === "matchedQty") {
      return num.toLocaleString();
    }
    return val;
  }, [column.id]);

  const filteredUniqueValues = useMemo(() => {
    return uniqueValues.filter((val) =>
      formatValue(val).toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [uniqueValues, searchTerm, formatValue]);

  const handleToggleValue = (val: string) => {
    const nextFilters = activeFilterValue.includes(val)
      ? activeFilterValue.filter((v) => v !== val)
      : [...activeFilterValue, val];
    
    column.setFilterValue(nextFilters.length > 0 ? nextFilters : undefined);
  };

  const handleSelectAll = () => {
    column.setFilterValue(uniqueValues.length > 0 ? uniqueValues : undefined);
  };

  const handleClear = () => {
    column.setFilterValue(undefined);
    setSearchTerm("");
  };

  const isFilterActive = activeFilterValue.length > 0;

  return (
    <div className={`flex items-center gap-1.5 justify-center relative select-none w-full ${className}`}>
      <span className="truncate text-white font-bold">{label}</span>
      
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`p-1 rounded cursor-pointer transition-all duration-200 outline-none ${
          isFilterActive
            ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/25 opacity-100"
            : "text-white opacity-40 hover:opacity-100 hover:bg-white/10"
        }`}
        title={isFilterActive ? `Filter active: ${activeFilterValue.length} items selected` : "Filter column"}
      >
        <ListFilter size={13} className="stroke-[2.5]" />
      </button>

      {isOpen && (
        <>
          {/* Transparent click-outside backdrop */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
          />
          
          {/* Floating Dropdown Filter Card */}
          <div
            className="absolute top-full left-0 mt-1.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 shadow-2xl rounded-lg p-2.5 z-50 flex flex-col gap-2 text-slate-800 dark:text-slate-200 font-sans text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search unique values..."
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-200"
            />

            {/* Quick Actions */}
            <div className="flex gap-2 justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                SELECT ALL
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
              >
                CLEAR
              </button>
            </div>

            {/* Options List */}
            <div className="max-h-40 overflow-y-auto pr-1 flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-850">
              {filteredUniqueValues.length === 0 ? (
                <div className="text-center text-slate-500 dark:text-slate-400 py-4 italic">
                  No matching values
                </div>
              ) : (
                filteredUniqueValues.map((val) => {
                  const isChecked = activeFilterValue.includes(val);
                  return (
                    <label
                      key={val}
                      className="flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 px-1.5 py-1 rounded cursor-pointer select-none transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleValue(val)}
                        className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="truncate text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                        {formatValue(val)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const FilterableColumnHeader = memo(FilterableColumnHeaderInner);

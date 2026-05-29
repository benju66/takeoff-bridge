import React from "react";
import { Activity } from "lucide-react";

// ---------------------------------------------------------------------------
// GridTable — Standard table chrome wrapper with title bar
// ---------------------------------------------------------------------------

interface GridTableProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  children: React.ReactNode; // <thead> + <tbody> + optional <tfoot>
  /** Additional className for the outer card container */
  className?: string;
}

export function GridTable({
  title,
  icon,
  badge,
  children,
  className = "",
}: GridTableProps) {
  return (
    <div
      className={`bg-card border border-grid-border text-card-foreground rounded-xl overflow-hidden shadow-sm animate-fade-in ${className}`}
    >
      <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          {icon ?? <Activity size={16} className="text-blue-600 dark:text-blue-400" />}
          {title}
        </h3>
        {badge && (
          <span className="text-[10px] bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full border border-grid-border font-sans font-semibold">
            {badge}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-separate border-spacing-0 font-sans">
          {children}
        </table>
      </div>
    </div>
  );
}

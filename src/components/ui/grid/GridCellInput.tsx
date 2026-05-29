import React from "react";

// ---------------------------------------------------------------------------
// GridCellInput — Consolidated editable cell input with focus ring pattern
// ---------------------------------------------------------------------------

interface GridCellInputProps {
  id?: string;
  type: "text" | "number";
  value: string | number;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Symbol displayed before the input value (e.g., "$") */
  prefix?: string;
  /** Symbol displayed after the input value (e.g., "%") */
  suffix?: string;
  align?: "left" | "center" | "right";
  step?: string;
  /** Minimum allowed value for number inputs */
  min?: number;
  /** Maximum allowed value for number inputs */
  max?: number;
  /** Additional className for the outer wrapper */
  className?: string;
}

const alignMap = { left: "text-left", center: "text-center", right: "text-right" };

export function GridCellInput({
  id,
  type,
  value,
  onChange,
  onKeyDown,
  onPaste,
  onContextMenu,
  disabled = false,
  placeholder,
  prefix,
  suffix,
  align = "center",
  step,
  min,
  max,
  className = "",
}: GridCellInputProps) {
  const disabledClasses = disabled
    ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
    : "text-foreground";

  return (
    <div className={`flex items-center justify-center w-full h-full relative ${className}`}>
      {prefix && (
        <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">
          {prefix}
        </span>
      )}
      <input
        id={id}
        type={type}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        className={`w-full h-full min-h-[36px] bg-transparent border-none rounded-none ${alignMap[align]} px-3 py-2 outline-none ${disabledClasses} focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10 transition-all font-mono`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
      />
      {suffix && (
        <span className="absolute right-2 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">
          {suffix}
        </span>
      )}
    </div>
  );
}

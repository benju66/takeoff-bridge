"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// ErrorBoundary — Reusable React error boundary (class component required)
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI to render on error */
  fallback?: ReactNode;
  /** Optional callback invoked with error details for telemetry */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught a rendering error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error card
      return (
        <div className="flex flex-col items-center justify-center border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/10 rounded-xl p-8 text-center">
          <AlertTriangle
            className="text-red-500 dark:text-red-400 mb-4"
            size={32}
          />
          <h3 className="text-sm font-bold text-red-700 dark:text-red-300 mb-2 uppercase tracking-wider">
            Component Render Error
          </h3>
          <p className="text-xs text-red-600/80 dark:text-red-400/80 mb-4 max-w-md font-mono break-all">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 text-xs px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <RotateCcw size={14} /> Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

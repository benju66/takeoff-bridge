"use client";

import React from "react";
import { ProcessedTakeoffRow, WorkbookCommand } from "@/types";
import { saveProjectRegistry, saveGlobalRegistry } from "@/lib/db";

// ---------------------------------------------------------------------------
// usePasteHandler — Multi-cell paste logic with full undo snapshot
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Step 2.3)
// ---------------------------------------------------------------------------

export interface UsePasteHandlerReturn {
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => void;
}

export function usePasteHandler(
  rows: ProcessedTakeoffRow[],
  userRegistry: Record<string, string>,
  globalRegistry: Record<string, string>,
  projectId: string,
  commandHistory: { pushCommand: (cmd: WorkbookCommand) => void },
  applyCellEditDirect: (
    updated: ProcessedTakeoffRow[],
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number,
    currentRegistry: Record<string, string>
  ) => Record<string, string> | null,
  setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>>,
  setUserRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setGlobalRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): UsePasteHandlerReturn {

  // ---------------------------------------------------------------------------
  // Paste handler
  // ---------------------------------------------------------------------------
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const clipboardData = e.clipboardData;
    const pastedText = clipboardData.getData("text") || "";

    if (pastedText.includes("\t") || pastedText.includes("\n") || pastedText.includes("\r")) {
      e.preventDefault();

      const columnsList: (keyof ProcessedTakeoffRow)[] = ["itemId", "description", "matchedQty", "unitPrice"];
      const fieldTypes: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
      const startColIdx = fieldTypes.indexOf(type);

      const lines = pastedText.split(/\r\n|\r|\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      const updated = [...rows];
      let currentRegistry = { ...userRegistry };
      let registryChanged = false;
      let didModify = false;

      let currentGlobalRegistry = { ...globalRegistry };
      let globalRegistryChanged = false;

      // Capture prevFields for each affected row BEFORE mutations
      const pasteEdits: Array<{
        rowId: string;
        field: keyof ProcessedTakeoffRow;
        prevFields: Partial<ProcessedTakeoffRow>;
        nextFields: Partial<ProcessedTakeoffRow>;
      }> = [];
      const prevRegistrySnapshot: Record<string, { prev: string; next: string }> = {};
      const prevGlobalRegistrySnapshot: Record<string, { prev: string; next: string }> = {};

      // Pre-capture row snapshots for all rows that will be affected
      const rowSnapshotsBefore: Record<number, Partial<ProcessedTakeoffRow>> = {};
      for (let i = 0; i < lines.length; i++) {
        const targetRowIdx = startRowIdx + i;
        if (targetRowIdx >= updated.length) break;
        const r = updated[targetRowIdx];
        rowSnapshotsBefore[targetRowIdx] = {
          itemId: r.itemId,
          description: r.description,
          matchedQty: r.matchedQty,
          unitPrice: r.unitPrice,
          total: r.total,
          isMapped: r.isMapped,
          procoreParentCode: r.procoreParentCode,
          uom: r.uom,
          costType: r.costType,
        };
      }
      // Also snapshot all rows for cascade captures (itemId edits cascade to siblings)
      const allRowSnapshotsBefore: Record<number, Partial<ProcessedTakeoffRow>> = {};
      for (let i = 0; i < updated.length; i++) {
        const r = updated[i];
        allRowSnapshotsBefore[i] = {
          itemId: r.itemId,
          description: r.description,
          matchedQty: r.matchedQty,
          unitPrice: r.unitPrice,
          total: r.total,
          isMapped: r.isMapped,
          procoreParentCode: r.procoreParentCode,
          uom: r.uom,
          costType: r.costType,
        };
      }

      for (let i = 0; i < lines.length; i++) {
        const targetRowIdx = startRowIdx + i;
        if (targetRowIdx >= updated.length) break;

        const line = lines[i];
        const cells = line.split("\t");

        for (let j = 0; j < cells.length; j++) {
          const targetColIdx = startColIdx + j;
          if (targetColIdx >= columnsList.length) break;

          const field = columnsList[targetColIdx];
          const rawValue = cells[j];

          didModify = true;

          // Capture registry key prev values before edit
          const row = updated[targetRowIdx];
          const classification = row?.classification;
          if (field === "itemId" && classification && classification !== "MANUAL ENTRY") {
            if (!prevRegistrySnapshot[classification]) {
              prevRegistrySnapshot[classification] = { prev: currentRegistry[classification] || "", next: "" };
            }
            if (!prevGlobalRegistrySnapshot[classification]) {
              prevGlobalRegistrySnapshot[classification] = { prev: currentGlobalRegistry[classification] || "", next: "" };
            }
          }

          const resultRegistry = applyCellEditDirect(updated, targetRowIdx, field, rawValue, currentRegistry);
          if (resultRegistry) {
            currentRegistry = resultRegistry;
            registryChanged = true;

            if (field === "itemId") {
              const r = updated[targetRowIdx];
              if (r) {
                currentGlobalRegistry = {
                  ...currentGlobalRegistry,
                  [r.classification]: String(rawValue).trim(),
                };
                globalRegistryChanged = true;
              }
            }
          }
        }
      }

      // Capture nextFields for all affected rows after mutations
      if (didModify) {
        // Build edits array from all rows that changed
        for (let i = 0; i < updated.length; i++) {
          const before = allRowSnapshotsBefore[i];
          if (!before) continue;
          const after = updated[i];
          // Check if this row was modified
          if (
            before.itemId !== after.itemId ||
            before.description !== after.description ||
            before.matchedQty !== after.matchedQty ||
            before.unitPrice !== after.unitPrice ||
            before.total !== after.total ||
            before.isMapped !== after.isMapped ||
            before.procoreParentCode !== after.procoreParentCode ||
            before.uom !== after.uom ||
            before.costType !== after.costType
          ) {
            // Determine which field to associate — use the first matching direct paste field
            const directLine = i - startRowIdx;
            let pasteField: keyof ProcessedTakeoffRow = "itemId";
            if (directLine >= 0 && directLine < lines.length) {
              const cells = lines[directLine].split("\t");
              if (cells.length > 0 && startColIdx < columnsList.length) {
                pasteField = columnsList[startColIdx];
              }
            }

            pasteEdits.push({
              rowId: after.id,
              field: pasteField,
              prevFields: { ...before },
              nextFields: {
                itemId: after.itemId,
                description: after.description,
                matchedQty: after.matchedQty,
                unitPrice: after.unitPrice,
                total: after.total,
                isMapped: after.isMapped,
                procoreParentCode: after.procoreParentCode,
                uom: after.uom,
                costType: after.costType,
              },
            });
          }
        }

        // Finalize registry delta next values
        for (const key of Object.keys(prevRegistrySnapshot)) {
          prevRegistrySnapshot[key].next = currentRegistry[key] || "";
        }
        for (const key of Object.keys(prevGlobalRegistrySnapshot)) {
          prevGlobalRegistrySnapshot[key].next = currentGlobalRegistry[key] || "";
        }

        const registryDelta: {
          projectRegistry?: Record<string, { prev: string; next: string }>;
          globalRegistry?: Record<string, { prev: string; next: string }>;
        } = {};
        if (registryChanged) {
          registryDelta.projectRegistry = prevRegistrySnapshot;
        }
        if (globalRegistryChanged) {
          registryDelta.globalRegistry = prevGlobalRegistrySnapshot;
        }

        // pushCommand BEFORE state setters (AGENTS.md guardrail)
        commandHistory.pushCommand({
          type: "PASTE",
          edits: pasteEdits,
          registryDelta: Object.keys(registryDelta).length > 0 ? registryDelta : undefined,
        });

        if (registryChanged) {
          setUserRegistry(currentRegistry);
          saveProjectRegistry(projectId, currentRegistry).catch((err) => console.error('Registry persist failed:', err));
        }
        if (globalRegistryChanged) {
          setGlobalRegistry(currentGlobalRegistry);
          saveGlobalRegistry(currentGlobalRegistry).catch((err) => console.error('Global registry persist failed:', err));
        }
        setRows(updated);
      }
    }
  };

  return { handlePaste };
}

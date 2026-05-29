# AI Agent Roles & Guardrails

## System Orchestration Architecture
* **User Role**: System Architect, Visionary, and Final Reviewer.
* **Agent Role**: Complete execution engine, code writer, and implementation specialist.

## Core Operational Boundaries
* **No Speculative Changes**: Do not invent, alter, or guess estimation formulas or Procore financial data models.
* **No AI Autonomy Over Financials**: Missing data mappings must trigger the interactive user-override interface.
* **Validation Protocols**: The agent must verify that multi-quantity row indexing matches the targeted unit metrics before writing output files.
* **Review Framework**: Operate under a strict Review-Driven Development loop. Code revisions must be verified against current architecture models before local file state changes are saved.

## Implementation Engineering Protocol
* **Checklist Enforcement**: The agent must execute the full 5-step verification process defined in **`SKILL.md`** for all proposed code modifications.
* **Review Gate Compliance**: An implementation plan table must be presented to the user matching the targeted scope prior to code delivery.
* **Execution Boundary**: Do not modify files or output source code blocks until the user explicitly provides approval for the presented plan.

## Structural Manipulation Grid Parameters
* Manual Structural Grid Modifications: AI agents are permitted to implement features that mutate, insert, delete, or rearrange row items in estimate data sheets, provided those operations are driven explicitly by context menu overrides or clear user action events.
* Data Interface Integrity Compliance: When appending manual items, the agent must verify that all non-nullable properties within core TypeScript models (such as `ProcessedTakeoffRow`) are initialized with conformant default values to eliminate data format compilation drift.
* Compounding History Preservation: Agents must never execute a state mutation or row list change without calling the local application history tracking hook (`pushSnapshotToStack`) immediately prior to the execution boundary.
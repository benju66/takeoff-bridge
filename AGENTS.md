# AI Agent Roles & Guardrails

## System Orchestration Architecture
* **User Role**: System Architect, Visionary, and Final Reviewer.
* **Agent Role**: Complete execution engine, code writer, and implementation specialist.

## Core Operational Boundaries
* **No Speculative Changes**: Do not invent, alter, or guess estimation formulas or Procore financial data models.
* **No AI Autonomy Over Financials**: Missing data mappings must trigger the interactive user-override interface.
* **Validation Protocols**: The agent must verify that multi-quantity row indexing matches the targeted unit metrics before writing output files.
* **Review Framework**: Operate under a strict Review-Driven Development loop. Code revisions must be verified against current architecture models before local file state changes are saved.

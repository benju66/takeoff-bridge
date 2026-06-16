# Linked Values — How-To Guide

_Audience: estimators using the Takeoff Bridge estimate workspace. No technical background needed._

Linked Values let a cell in your estimate **compute itself from somewhere else** instead of
holding a number you typed. A linked cell stays correct on its own: when the thing it points
at changes, it updates instantly. You can always see exactly where its number comes from.

This guide covers what it is, when to use it, every step to create and manage a link, a full
reference for the rule builder, worked examples, and answers to common questions.

---

## Contents

1. [What a "link" is](#1-what-a-link-is)
2. [When to use it (and when not to)](#2-when-to-use-it-and-when-not-to)
3. [The two kinds of link](#3-the-two-kinds-of-link)
4. [Which cells you can link](#4-which-cells-you-can-link)
5. [Create a Lookup (mirror a value)](#5-create-a-lookup-mirror-a-value)
6. [Create a Rollup (add up many lines)](#6-create-a-rollup-add-up-many-lines)
7. [The rule builder — full reference](#7-the-rule-builder--full-reference)
8. [The live preview and the circular-reference guard](#8-the-live-preview-and-the-circular-reference-guard)
9. [Reading a linked cell in the grid](#9-reading-a-linked-cell-in-the-grid)
10. [Inspect a link — the "Links" tab](#10-inspect-a-link--the-links-tab)
11. [Edit, delete, and undo](#11-edit-delete-and-undo)
12. [What linking does NOT do](#12-what-linking-does-not-do)
13. [Worked examples / recipes](#13-worked-examples--recipes)
14. [Best practices](#14-best-practices)
15. [Troubleshooting & FAQ](#15-troubleshooting--faq)
16. [Limitations to know about](#16-limitations-to-know-about)
17. [Quick reference card](#17-quick-reference-card)

---

## 1. What a "link" is

Normally an estimate cell holds a number you typed (a quantity, a price). A **link** replaces
that with a rule: *"always equal X."* The app keeps the cell up to date automatically.

Two things are always true about a linked cell:

- **It's live.** Change the source and the linked cell recomputes immediately — no refresh.
- **It's a reference, not new money.** A linked cell shows a figure for visibility and reuse,
  but it does **not** add to your project total. (See [section 12](#12-what-linking-does-not-do)
  for why — it prevents double-counting.)

A linked cell becomes **read-only** (you can't type over it) and is marked with a small
**🔗 bound** tag so it's obvious it's computed.

---

## 2. When to use it (and when not to)

**Good uses**

- You want a cell to always equal a percentage or multiple of another value
  (e.g. a contingency line that tracks a division subtotal).
- You want a summary/check cell that adds up a group of lines
  (e.g. "total of all my concrete labor lines") and stays correct as those lines change.
- You want a single, inspectable place that mirrors a STEP 2 (General Conditions) or
  STEP 3 (Site Operations) total into your STEP 4 estimate for reference.

**Not the right tool**

- You want to *add brand-new cost* to the estimate total — typing a normal line is correct;
  a link is a reference and won't change the total.
- You want a free-form spreadsheet formula (`=A1*B2+C3`). That isn't available; links are
  deliberately limited to the safe, inspectable shapes below.

---

## 3. The two kinds of link

| Kind | Plain meaning | Example |
|------|---------------|---------|
| **Lookup** | Mirror **one** value, optionally scaled | "This cell = the Supervision total" or "= 3% of that line" |
| **Rollup** | **Add up / summarize** a group of lines you describe | "Sum of every Division 03 line's total" |

You pick the kind at the top of the panel when you create the link.

---

## 4. Which cells you can link

You link a link from a **row's total** on the **STEP 4 Estimate** grid (the Takeoff Workbook).

You **can** link:
- Normal estimate rows (from the template, ones you added by hand, or ones already saved).

You **cannot** link:
- The 10 built-in **GC / Site-Ops "linked division" rows** — those are managed by the app and
  already pull from STEP 2/3.
- Rows from a **just-imported bid that hasn't been saved yet** — save the estimate first, then
  link (this keeps the link pointing at a stable row).

If a row can't be linked, the **"Define link…"** menu item simply won't appear on it.

---

## 5. Create a Lookup (mirror a value)

1. On the STEP 4 grid, **right-click the row** whose total you want to compute.
2. Choose **🔗 Define link…**. The link panel opens.
3. At the top, make sure the toggle is set to **Lookup (mirror a value)**.
4. Open the **"Mirror this value"** dropdown and pick a source. Sources are grouped:
   - **General Conditions (STEP 2):** Personnel grand total · Total Supervision · Design / PM / GCs
   - **Site Operations (STEP 3):** each section (02.A Site Operations … 02.H Special Inspections)
   - **Estimate lines:** any other linkable row's total (shown by its code and description)
5. (Optional) Adjust the transform:
   - **× Multiply** — scale the source (e.g. `0.03` for 3%). Default `1`.
   - **+ Add** — add a flat amount on top. Default `0`.
   - The cell will equal: **source × multiply + add**.
6. Check the **green Result preview** — it shows exactly what the cell will become.
7. Click **Create link**.

The row's total now mirrors the source and shows the **🔗 bound** tag.

> **Example:** To make a row always equal **3% of the Personnel grand total**: pick
> *Personnel grand total*, set **× Multiply = 0.03**, **+ Add = 0**.

---

## 6. Create a Rollup (add up many lines)

1. Right-click the target row → **🔗 Define link…**.
2. Set the toggle to **Rollup (aggregate lines)**.
3. Choose the **Operation**: Sum, Count, Average, Minimum, or Maximum.
4. Choose **Of field**: Total ($), Unit price ($), or Quantity.
   (For **Count**, the field doesn't matter — it just counts matching rows.)
5. Choose **which lines are included**:
   - **By rule** (recommended) — describe the lines, e.g. *Division equals 03*. See the
     [rule builder reference](#7-the-rule-builder--full-reference) below.
   - **Hand-pick rows** — tick specific rows. The panel warns you this is fragile (see
     [best practices](#14-best-practices)); prefer a rule whenever you can.
6. The **Result preview** shows the computed value **and how many rows matched**
   (e.g. "Result $48,200 · 6 rows"). Use the row count to sanity-check your rule.
7. Click **Create link**.

> **Example:** A check cell that totals all concrete: Operation **Sum**, Of field **Total ($)**,
> By rule **Division equals 03**.

---

## 7. The rule builder — full reference

A rule decides which lines a Rollup includes. You build it from one or more **conditions**.
With more than one condition, you choose **Match ALL of these** (every condition must hold) or
**Match ANY of these** (at least one). Use **+ Add rule** to add conditions and the trash icon
to remove them.

Each condition has three parts: **field**, **match**, **value**.

**Fields** (what to test on each line):

| Field | What it means | Example value |
|-------|---------------|---------------|
| Division | The 2-digit division | `03` |
| Base code | The code before the dot | `03-0000` |
| Suffix | The part after the dot | `001` |
| Cost type | Labor / Material / Subcontract / Equipment | `L` |
| Item code | The full cost code | `03-0000.001` |
| Procore code | The mapped Procore budget code | `3-3000.000` |
| Source | How the line was added: `template`, `csv_import`, or `manual` | `manual` |

**Matches** (how to compare):

| Match | Meaning | Value to enter |
|-------|---------|----------------|
| equals | Exact match | `03` |
| starts with | Begins with | `03-` |
| is one of | Matches any in a list | `03, 04, 09` (comma-separated) |

**Putting it together**

- *Division equals 03* → every Division 03 line.
- *Cost type equals L* → every Labor line.
- **ALL of:** *Division equals 03* **and** *Cost type equals L* → only Division 03 **Labor** lines.
- *Division is one of `03, 04`* → every Division 03 or 04 line.
- *Base code starts with 09-21* → every line whose base code begins `09-21`.

Membership is **recalculated automatically** — if you later add another Division 03 line, a
"Division equals 03" rollup picks it up on its own. That's the big advantage of rules over
hand-picking.

---

## 8. The live preview and the circular-reference guard

- **Live preview.** As you build the link, the panel shows the **exact value** the cell will
  take (and the matched row count for rollups). You never have to save to find out what it does.
- **Circular-reference guard.** If a link would make a cell depend on itself — directly or
  through a chain (A → B → A) — the preview turns **amber**, shows the loop, and the **Create /
  Save button is disabled.** You cannot create a broken, self-referencing link. Change the
  source (or the rule) until the preview is green again.

A common, expected case: a Rollup that includes its **own row** in its set (e.g. summing
"Division 06" on a row that is itself in Division 06) is a loop and will be blocked. Point the
rollup at a different group, or move the target row's intent.

---

## 9. Reading a linked cell in the grid

Once a link is saved, the row changes in three visible ways:

- The **total** shows the computed value (green) and **can't be typed over**.
- The row's **quantity and price cells are locked** (the link owns the total).
- The description shows a small **🔗 bound** tag.

If anything the link depends on changes, the cell updates **immediately** — there's nothing to
refresh or recalculate.

When you reopen the project later, links come back automatically and their values are
**recomputed fresh from the current source** (you never see a stale saved number).

---

## 10. Inspect a link — the "Links" tab

Click the **🔗 bound** tag on any linked row. The **Trust Inspector** opens on the right with a
**Links** tab showing:

- **Focused value** — the cell you're inspecting and its current amount.
- **Depends on** — the value(s) this cell reads, each with its current amount. If a source is
  another estimate row, click **view** to jump the grid straight to it.
- **Used by** — any other links that read this cell (so you can see the ripple before you change
  something).

The Links tab sits alongside the existing **Trace** and **Reconcile** tabs. Trace shows how a
**total** breaks down; Links shows what **one cell** reads and feeds. Both are views of the same
dependency picture.

You can also reach the inspector from the **Trust** button and switch to the **Links** tab.

---

## 11. Edit, delete, and undo

- **Edit:** right-click a linked row → **🔗 Edit link…**. The panel reopens pre-filled with the
  current settings. Change anything and click **Save changes**.
- **Delete:** open **Edit link…** and click **Delete link** (bottom-left). The cell reverts to a
  normal, editable cell.
- **Undo / redo:** **Ctrl+Z** undoes creating, editing, or deleting a link — exactly like any
  other grid change. **Ctrl+Y** (or **Ctrl+Shift+Z**) redoes.

Each row can hold **one link at a time.** Saving a new link on an already-linked row replaces the
old one (and a single Ctrl+Z brings the old one back).

---

## 12. What linking does NOT do

This is the most important thing to understand, and it's intentional:

> **A linked cell does not change your Total Estimated Cost, and it does not change the Procore
> export.** It is a *reference value*.

Why: every value you can point a link at is **already counted** somewhere in the estimate. If a
linked cell also fed the bottom line, that money would be **counted twice**. For example, a
rollup that sums your Division 03 lines is summing money that's already in the subtotal —
re-adding it would inflate the total by the size of Division 03.

So you can add links freely for **visibility, cross-checks, and reuse** with complete confidence
that your totals, your reconciliation, and your Procore export are untouched.

---

## 13. Worked examples / recipes

**A. Contingency that tracks a value**
Make a row always equal 5% of the Personnel grand total.
→ Lookup · source *Personnel grand total* · **× 0.05** · **+ 0**.

**B. "All concrete" check line**
A row that shows the sum of every Division 03 line.
→ Rollup · **Sum** · field **Total ($)** · By rule **Division equals 03**.

**C. Labor-only subtotal for a division**
Sum of Division 09 **Labor** lines only.
→ Rollup · **Sum** · **Total ($)** · By rule, **Match ALL of:** *Division equals 09* **and**
*Cost type equals L*.

**D. Mirror a Site-Ops section for reference**
Show the Demolition section total on a STEP 4 row.
→ Lookup · source *02.B — Demolition* · **× 1** · **+ 0**.

**E. Count how many lines are in a family**
How many lines start with base code `09-2100`.
→ Rollup · **Count** · By rule **Base code starts with 09-2100**.

**F. Highest unit price in a group**
The max unit price among Division 04 lines.
→ Rollup · **Maximum** · field **Unit price ($)** · By rule **Division equals 04**.

---

## 14. Best practices

- **Prefer rules over hand-picking.** A rule ("Division equals 03") automatically includes new
  matching lines and never breaks. A **hand-picked** list is tied to specific rows and can go
  stale if the estimate is re-imported or rows are reordered — the panel warns you in amber for
  this reason. Only hand-pick when a rule genuinely can't express what you want.
- **Use the row count in the preview** to confirm a rollup is catching the lines you expect
  (and only those).
- **Save the estimate before linking imported rows**, so links point at stable rows.
- **Check the Links tab before big changes** — "Used by" shows what will move if you edit a
  source.
- **Keep totals honest:** remember a link is a reference. If you actually need to add cost, add a
  normal line.

---

## 15. Troubleshooting & FAQ

**The "Define link…" menu item isn't there.**
The row isn't linkable — it's one of the 10 built-in GC/Site-Ops rows, or it's a just-imported
row that hasn't been saved yet. Save the estimate and try a normal row.

**The Save/Create button is greyed out.**
Either the link is incomplete (pick a source / enter a rule value) or it would create a
**circular reference** (the preview will say so, in amber). Fix the highlighted issue.

**My linked cell shows $0.00.**
The source currently evaluates to zero (e.g. a rollup whose rule matches no rows — check the
"· N rows" count, or a source value that is genuinely 0). Adjust the rule or source.

**I linked a cell and my project total didn't change.**
That's correct and intended — links are references and never change the total or the export
(see [section 12](#12-what-linking-does-not-do)).

**Can a cell have two links?**
No — one link per cell. Saving a new one replaces the old (undoable).

**Will my links survive a reload / reopening the project?**
Yes. They're saved with the estimate and recomputed fresh from the source each time you open it.

**Can I link a cell to a free-form formula?**
Not today. Links are limited to Lookups and Rollups by design (so they stay inspectable and
can't silently break).

**I edited a source — do I need to recalc?**
No. Linked cells update instantly.

---

## 16. Limitations to know about

- **Imported (finished) bids:** for an imported bid, the General Conditions and Site Operations
  *section sources* reflect the app's standard calculators, **not** the frozen numbers captured
  in that bid. Linking **line-to-line** and **rollups over lines** work correctly on imports;
  just be aware that a Lookup into a STEP 2/3 *section* on an imported project may not match the
  bid's original GC/Site-Ops figure.
- **One level of grouping in rules.** You can combine conditions with ALL or ANY at a single
  level. Deeply nested logic (groups inside groups) isn't available in the builder.
- **No writing back into STEP 2/3.** A link can *read* a STEP 2/3 total; it can't change a STEP
  2/3 input.
- **No free-form formulas / cell ranges.** Links reference values by name or by rule, never by
  spreadsheet cell address.

---

## 17. Quick reference card

| I want to… | Do this |
|------------|---------|
| Start a link | Right-click a row → **🔗 Define link…** |
| Mirror one value | **Lookup** → pick source → optional ×/＋ |
| Add up a group | **Rollup** → Sum → field → **By rule** |
| Include specific lines | Rule, e.g. *Division equals 03* (prefer rules over hand-pick) |
| See the result before saving | Read the **Result** preview (green = OK, amber = loop) |
| See where a value comes from | Click the **🔗 bound** tag → **Links** tab |
| Jump to a source row | In the Links tab "Depends on" list, click **view** |
| Change a link | Right-click → **🔗 Edit link…** → Save changes |
| Remove a link | **Edit link…** → **Delete link** |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** |

**Remember:** a linked cell is a **live, traceable reference** — it shows a number and updates
itself, but it never changes your estimate total or your Procore export.

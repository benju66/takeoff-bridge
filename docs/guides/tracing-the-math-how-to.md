# Tracing the Math — How-To Guide

_Audience: estimators using the Takeoff Bridge estimate workspace. No technical background needed._

Every number in your estimate is now **traceable**. Click the small **🔗** next to any value — in
General Conditions (STEP 2), Site Operations (STEP 3), or the STEP 4 summary — and the app shows
you exactly **what that number is made of** and **what it feeds into**, all the way down to a
quantity × rate. You can then **walk** the chain hop by hop, step **back**, or **search** for any
value by code or name.

This is the "glass box": it doesn't change a single dollar — it just makes the built-in math
visible so you can check and trust it. It's the companion to the
[Linked Values guide](linked-values-how-to.md): that one is about **creating your own** links;
this one is about **seeing how the whole estimate is wired**, including all the math the app
already does for you.

---

## Contents

1. [What "tracing" shows you](#1-what-tracing-shows-you)
2. [The 🔗 trace button — where to find it](#2-the--trace-button--where-to-find-it)
3. [What opens: the Links tab](#3-what-opens-the-links-tab)
4. [Reading a value's label (code + name)](#4-reading-a-values-label-code--name)
5. [Walk the graph — click to keep tracing](#5-walk-the-graph--click-to-keep-tracing)
6. [Breadcrumb & back](#6-breadcrumb--back)
7. [Find a value — search](#7-find-a-value--search)
8. [What you can trace (the whole estimate)](#8-what-you-can-trace-the-whole-estimate)
9. [Division rollups](#9-division-rollups)
10. [Trace vs Links — two views](#10-trace-vs-links--two-views)
11. [What tracing does NOT do](#11-what-tracing-does-not-do)
12. [Worked examples / recipes](#12-worked-examples--recipes)
13. [Best practices](#13-best-practices)
14. [Troubleshooting & FAQ](#14-troubleshooting--faq)
15. [Limitations to know about](#15-limitations-to-know-about)
16. [Quick reference card](#16-quick-reference-card)

---

## 1. What "tracing" shows you

Pick any value and the app answers two questions about it:

- **"What is this made of?"** — the values it reads to compute itself (its **inputs**).
- **"What reads this?"** — everything that feeds off it (its **dependents**).

For example, the **Site Operations grand total** is made of the *parameter-driven subtotal* and
the *manual-entry subtotal*; each of those is made of individual line totals; each line total is
made of a **quantity × rate**. Tracing lets you follow that whole chain without leaving the screen
— and it's the engine's *own* numbers, shown read-only, so what you see is exactly what the
estimate computed.

---

## 2. The 🔗 trace button — where to find it

A small **🔗** sits next to traceable values across the workspace:

| Page | The 🔗 appears on… |
|------|-------------------|
| **STEP 2 — General Conditions** | every line's **Total Cost**, and the **Division 01 grand total** |
| **STEP 3 — Site Operations** | every line's **Total Cost**, each **section subtotal**, and the **grand total** |
| **STEP 4 — Estimate summary** | the **Subtotal**, each of the 7 **modifiers**, and the **Total Estimated Cost** (a small 🔗 links icon, next to the 🔍 trace icon) |
| **STEP 4 — linked rows** | the **🔗 bound / 🔗 <source>** tag on a linked-division row |

> **Heads-up:** the inspector lives on the **STEP 4 Estimate** screen. When you click a 🔗 on the
> General Conditions or Site Operations page, the app **takes you to STEP 4** and opens the
> inspector focused on the value you clicked. That's expected — you're being brought to the place
> where the wiring is shown.

---

## 3. What opens: the Links tab

Clicking a 🔗 opens the **Trust Inspector** on the right, on its **Links** tab. You'll see:

- **Focused value** — the value you're inspecting, its label, and its current amount. A short note
  says whether it's *computed by the engine* (read-only), a *linked value*, or a plain typed cell.
- **Depends on** — the values this one reads to compute itself, each with its current amount.
- **Used by** — everything that reads this value (so you can see the ripple before you change a
  source).

Each row in those two lists is **clickable** (see [section 5](#5-walk-the-graph--click-to-keep-tracing)).
If a row is an estimate line, it also has a **view** button that jumps the STEP 4 grid straight to
that row.

---

## 4. Reading a value's label (code + name)

Every value is labelled with **where it lives, its code, and its name**, so it reads the same as
the page you came from:

| You see | It means |
|---------|----------|
| `STEP 2 · 01-0310.001 · Project Executive` | a General Conditions line total |
| `STEP 2 · 01-0310.001 · Project Executive (rate)` | the **rate** that line uses (a `(qty)` version exists too) |
| `STEP 2 · Personnel grand total` | the Division 01 grand total |
| `STEP 3 · 02-4100.001 · Demolition` | a Site Operations line total |
| `STEP 3 · 02.B — Demolition` | a Site Operations **section** subtotal |
| `Summary · 60-4000.001 · Fee` | a STEP 4 summary modifier |
| `Summary · Cost / SF` | a STEP 4 cost-per-metric value |
| `Division 09 · Finishes` | a [division rollup](#9-division-rollups) |
| `09-2100.001 · Drywall` | a STEP 4 estimate line |

The **code** shown is the same one in that page's Code column, so a value is easy to match up.

---

## 5. Walk the graph — click to keep tracing

The Links tab shows **one hop** at a time, but you can keep going: **click any value** in the
**Depends on** or **Used by** list and the inspector **re-focuses on it**, showing *its* inputs and
dependents. Click again and you move another hop. This lets you walk a whole chain:

> **Site Operations grand total** → click *Parameter-driven subtotal* → click a line total →
> see its **quantity** and **rate**.

…or the other direction (a leaf up to the totals it feeds). Nothing reloads — each hop is instant.

A line value (like `09-2100.001 · Drywall`) does two things: clicking the **row** re-focuses on it
(keep tracing), while its **view** button jumps the grid to that row.

---

## 6. Breadcrumb & back

Once you've moved past the first value, a **trail** appears at the top of the Links tab showing
where you've been, e.g.:

`‹ back   Grand total › Parameter-driven subtotal › 02-4100.001 · Demolition`

- **‹ back** steps back one hop.
- Click any **earlier crumb** to jump straight back to that point.

So you can dive deep and retrace your steps without losing your place.

---

## 7. Find a value — search

At the top of the Links tab is a **Find a value…** box. Type a **code** or a **name** and it lists
every matching value in the whole estimate; click one to jump straight to it (and start tracing
from there).

- Type `supervision` → finds *STEP 2 · Total Supervision*.
- Type `60-4000` → finds *Summary · 60-4000.001 · Fee*.
- Type `09-2100` → finds the *Drywall* line.

The box is idle until you type, and it shows the closest matches first.

---

## 8. What you can trace (the whole estimate)

Tracing covers **every** value the estimate computes, not just links you authored:

- **The STEP 4 money trail.** Subtotal → each of the 7 modifiers → Total Estimated Cost →
  Cost / SF and Cost / Unit.
- **The General Conditions tree (STEP 2).** Grand total → the staff / operational / equipment /
  manual subtotals → each line total → its quantity and rate. (Plus *Total Supervision* and
  *Design / PM / GCs*.)
- **The Site Operations tree (STEP 3).** Grand total → parameter-driven and manual subtotals →
  each line total → its quantity and rate, and the eight template sections.
- **Division rollups (STEP 4).** A per-division total wired to that division's line items —
  see [section 9](#9-division-rollups).
- **Your own Linked Values** (Lookups and Rollups you created) — these show up here too, exactly
  as the [Linked Values guide](linked-values-how-to.md) describes.

In other words: if a number appears in your estimate, you can click it and see how it was built.

---

## 9. Division rollups

A **division rollup** is a value that equals the **sum of all the STEP 4 line totals in one CSI
division** (e.g. *Division 09 · Finishes* = the total of every Division 09 line). You'll meet them
while tracing:

- Focus a **STEP 4 line** and its **Used by** list shows the `Division NN` rollup it belongs to.
- Focus a **`Division NN` rollup** and its **Depends on** list shows the line items that make it
  up.

It's the easy way to answer "what's my total for Division 09, and which lines are in it?" — and to
walk from the line up to its division, or from the division down to its lines.

---

## 10. Trace vs Links — two views

The inspector has both a **Trace** tab and a **Links** tab, and they answer different questions:

| Tab | Best for | How it reads |
|-----|----------|--------------|
| **Trace** | "How does a **grand total** break down?" | Top-down: the whole Total Estimated Cost decomposed in one view. |
| **Links** | "What does **this one value** read and feed?" | One hop each way, and **walkable** to anywhere. |

Use **Trace** for a top-to-bottom picture of the bottom line; use **Links** to start at any value
and explore its connections.

---

## 11. What tracing does NOT do

This is purely a **viewing** feature, by design:

> **Tracing never changes a number, a total, the database, or the Procore export.** It shows how
> values are wired; it doesn't edit them.

- **Engine values are read-only here.** The note on the focused value says so. The engine is the
  authority — the Links tab shows *how* a number is calculated, not an editable formula.
- **To change a GC or Site-Ops value, edit its input** on STEP 2 / STEP 3 (the quantity, rate, or
  utilization). The trace updates to match.
- **Opening a trace from STEP 2/3 moves you to STEP 4.** That's navigation, not a change to your
  estimate.

(If you want a cell that *computes itself* from another value, that's the separate **Linked
Values** feature — see its [guide](linked-values-how-to.md).)

---

## 12. Worked examples / recipes

**A. "Where does my Fee come from?"**
On STEP 4, click the **🔗** next to the **Fee** total → Links tab shows it **depends on** the
Subtotal, and is **used by** the Total Estimated Cost.

**B. "Break down a General Conditions role."**
On STEP 2, click the **🔗** next to a staff line's Total Cost → it **depends on** that role's
**quantity** and **rate**, and is **used by** the staff subtotal (and the grand total, via walking).

**C. "Trace Site-Ops Demolition to its drivers."**
On STEP 3, click the **🔗** on the **Demolition** line → see its **quantity × rate**; click **back**,
then click the **02.B — Demolition** section to see every line in that section.

**D. "What's in Division 09?"**
Trace any Division 09 line, then in **Used by** click **Division 09** → its **Depends on** lists
every Division 09 line and the total is their sum.

**E. "Walk the Site Operations grand total to a single driver."**
STEP 3 grand total 🔗 → click *Parameter-driven subtotal* → click a line → read its quantity and
rate. Use **‹ back** to climb out.

**F. "Jump straight to a value."**
Open Links (any 🔗), type `supervision` in **Find a value…**, click the result.

---

## 13. Best practices

- **Use the code in the label** to confirm you're looking at the value you think you are — it
  matches the Code column on STEP 2/3.
- **Check "Used by" before changing an input.** It shows everything that will move when you change
  a quantity or rate.
- **Walk, don't guess.** Instead of hunting through pages, click through Depends-on / Used-by to
  follow the exact chain; use **back** to retrace.
- **Search when you know the code or name.** Faster than scrolling.
- **Remember it's read-only.** To change a number, edit its input on the relevant step — the trace
  will reflect it instantly.

---

## 14. Troubleshooting & FAQ

**I clicked a 🔗 on STEP 2/3 and it took me to STEP 4.**
That's expected — the inspector lives on STEP 4, so the app brings you there focused on the value
you clicked.

**A value shows $0.00 when I trace it.**
The value genuinely computes to zero right now (e.g. a General Conditions role with 0% utilization,
or a Site-Ops line with no quantity entered). Enter the input on STEP 2/3 and the trace updates.

**The Depends-on / Used-by row won't let me edit the number.**
Correct — engine values are read-only in the inspector. Change the underlying input on STEP 2/3
(quantity, rate, utilization); the trace follows.

**Can I get back to where I started after walking around?**
Yes — use **‹ back**, or click an earlier crumb in the breadcrumb trail.

**My search finds nothing.**
Check spelling, or try a shorter fragment (a partial code like `02-41`, or part of a name like
`demo`). The box matches on both code and name.

**Does tracing change my total or the export?**
No — it's view-only and never touches a dollar, the database, or the Procore export.

**Do I see traces on an imported (finished) bid?**
Imported bids show their captured STEP 2/3 detail read-only and don't carry the per-line trace
badges; tracing is for the standard (parametric) estimate workflow. See
[limitations](#15-limitations-to-know-about).

---

## 15. Limitations to know about

- **Imported (finished) bids.** The per-cell trace badges appear on the standard STEP 2/3
  calculators, not on the read-only captured detail an imported bid shows. (Same spirit as the
  Linked Values guide's import note.)
- **Read-only inspection.** Tracing shows *how* a value is wired; it isn't an editable formula, and
  you can't re-author the built-in math here. (Editing your *own* relationships is the separate
  Linked Values feature.)
- **One hop at a time (but walkable).** Each view shows one hop in each direction; you reach
  anywhere by walking. There isn't a full all-at-once diagram of the whole estimate.
- **STEP 2/3 traces open on STEP 4.** The inspector is hosted on the Estimate screen, so a trace
  from another step navigates there.

---

## 16. Quick reference card

| I want to… | Do this |
|------------|---------|
| Trace any value | Click the **🔗** next to it (STEP 2, STEP 3, or the STEP 4 summary) |
| See what a value is made of | Read the **Depends on** list |
| See what reads a value | Read the **Used by** list |
| Keep tracing | **Click** any row in Depends-on / Used-by to re-focus on it |
| Jump to a line in the grid | Click the **view** button on a line row |
| Go back a step | **‹ back**, or click an earlier breadcrumb |
| Jump to any value | Type a code or name in **Find a value…** |
| See a total break down top-down | Use the **Trace** tab instead of Links |
| Change a GC / Site-Ops number | Edit its input on STEP 2 / STEP 3 (the trace updates) |

**Remember:** tracing is a **read-only glass box** — it shows exactly how every number is built and
what it feeds, but it never changes your estimate total or your Procore export.

# Backlog — `lumpSum → qtyRate` re-classification audit (GC Site-Ops grids)

_2026-06-18 · status: BACKLOG (address eventually; not blocking any phase)_

> Surfaced during the B3 template-column follow-on (`f2baff4`). The company estimate
> template (`templates/Company_Estimate_Template.xlsx`, STEP 2/3 sheets) models **every**
> line as `Total = Quantity × Rate` with both cells editable. The app currently classifies
> ~30 lines as **`lumpSum`** — the estimator types ONE number (the total $); the grid pins
> **Quantity = 1** and puts the amount in the editable Rate. This backlog is about flipping
> the lines that have a *real unit* to **`qtyRate`** (two editable cells: a quantity AND a
> unit rate) so they read like the template.
>
> **This list is ADVISORY — the architect (domain expert) makes the final per-line call.**
> Per AGENTS.md "No Speculative Changes," nothing here alters an estimation formula; it only
> proposes which lines *should* expose a quantity × unit-rate breakdown.

---

## Why it isn't free (the gate when this is picked up)

A `lumpSum` line stores its dollar amount in the **quantity** slot (`quantities[key]` /
`site_ops_quantities`), with `rate` absent. If a line is flipped to `qtyRate` naively, that
stored "$25,000" is read as **qty 25,000 × rate $0 = $0** — silently zeroing saved estimates
and potentially moving the export goldens. So the change needs:
1. A load-time **interpretation/migration** for the flipped keys (e.g. carry the old lump value
   to `rate` with `qty = 1`, OR a one-shot rewrite), and
2. **Golden re-verification** — McKenna / synthetic / CARE must still tie to the cent (check
   whether any app-born golden sets a non-zero value on a flipped line; CARE is imported/frozen
   so it is unaffected).

Scope: flip the chosen lines' `entry` in `SITE_OPS_MANUAL_DEFAULTS` / `GC_MANUAL_DEFAULTS`
(equipment lines are a separate `EquipmentExpenseConfig` shape — flipping those is a bigger
change, see below). Small, focused, its OWN change — do NOT bundle into B4. Natural to pair
with **B5** (the qty/qtyRate/lumpSum one-off vocabulary) but stands alone.

---

## Audit — current `lumpSum` lines, with a recommendation

### A) Strong flip → `qtyRate` (a real unit the estimator counts)
| Code | Line | Natural quantity × rate |
|---|---|---|
| 02-5100.001 | FFE Relocation | # items/workstations × $/unit |
| 02-4100.002 | Demolition - Sawcutting | linear feet × $/LF |
| 02-9410.001 | Scaffolding & Platforms | months × $/mo (recurring rental) |
| 02-9415.001 | Crane Rental | months × $/mo (recurring rental) |

### B) Borderline → architect's call (a plausible unit, but often bid as one lump)
| Code | Line | If flipped |
|---|---|---|
| 02-9065.001 | Construction Permits (not building permit) | # permits (ea) × $/permit |
| 02-8213.001 | Abatement | SF × $/SF if self-performed (often a sub lump) |
| 02-9520.001 | Window Testing | # tests × $/test |
| 02-9515.001 | Acoustic Testing | # tests × $/test |
| 02-9505.001 | Construction Materials Testing | # visits/tests × $/each (often an allowance) |
| 01-5130.001 | Dumpsters | months × $/mo — but the label says "(Lump Sum)" (company convention) |
| 01-5140.001 | Temp Toilets | months × $/mo — label says "(Lump Sum)" |

### C) Keep as true lump / allowance (no natural unit, or a fee / % / sub quote)
| Code | Line | Why keep lump |
|---|---|---|
| 02-9200.001 / .002 | Survey & Layout / Floor Scanning | lump survey scope |
| 02-9305.001 | City Requirements | allowance |
| 02-9310.001 / .315 / .320 / .325 / .330 | Perm/Temp Power, Gas, Cable, Data Service | utility connection allowances |
| 02-9510.001 / 02-9525.001 / 02-9530.001 | Vibration / Weather Barrier / Gypcrete Testing | allowance / sub quote |
| 01-5170.001 | Temp Electric | lump (label "Lump Sum") |
| 01-0001.001 | Preconstruction Fees | fee |
| 01-0130 / .160 / .180 / .210 | Design - Arch / Civil / MEP / Structural | design fees (lump) |
| 01-0610.001 | Safety Consultant | %-of-estimate hint → typed lump |
| 01-1600.001 | Procore | %-of-estimate hint → typed lump |
| 01-1400.001 | Travel and Meals | allowance |

> Notes: GC **equipment** (dumpsters/toilets/electric) are a distinct `EquipmentExpenseConfig`
> (no `entry` field, always a typed amount) — converting them to qty×rate is a larger refactor
> than the manual-line flip, so treat equipment as a stretch item even if (B) says "borderline."
> The `qty` manual lines that ALREADY have a unit rate (e.g. Knox Box, Site Security, Temp
> Partitions) are out of scope — they're already qty-driven; this backlog is only the `lumpSum`
> set.

---

## Suggested approach when picked up
1. Architect confirms the final flip set (A + any of B).
2. Flip those lines' `entry: "lumpSum" → "qtyRate"` in the constants (+ give them a sensible
   default `rate` if one applies, else keep `null` so the estimator types both).
3. Add the load-time interpretation for the flipped keys (old lump value → `rate`, `qty = 1`)
   so existing saved estimates + the goldens are byte-identical.
4. The grid already supports `qtyRate` (editable Quantity + editable Rate, as Soil Borings does
   today) — no new UI.
5. DoD incl. **both export goldens $0.00** + a calc test proving the flipped lines reproduce
   their prior totals from the migrated inputs.

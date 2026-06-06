# Phase 1 Findings — Forensic Verification of GC/Site Ops Template (READ-ONLY)

- **Plan:** `docs/plans/gc-siteops-export-step2-step3.md` (Phase 1 of 4)
- **Date:** 2026-06-05
- **Template inspected:** `templates/Company_Estimate_Template.xlsx` at commit `4eab1f1` (finalized, closed, committed)
- **Method:** unzipped the .xlsx and parsed the raw OOXML (sheet XML + sharedStrings, shared-formula
  translation handled, cells read in ascending column order). Sheet files: STEP 2 = `sheet5.xml`,
  STEP 3 = `sheet6.xml`, STEP 4 = `sheet7.xml`, Budget Line Items = `sheet17.xml`, Importer = `sheet18.xml`.
- **Source-of-truth rule (§0.D):** the user's confirmed mappings are authoritative; template SUMIFs are
  advisory. Every disagreement below is surfaced, not resolved.

---

## 1. Verdict (one paragraph, plain language)

The finalized template **agrees with your confirmed mappings**. The five curb/site-concrete items now
live at `32-1613.002–.006` with the correct descriptions, units, and prices; `32-1313.001` now holds
"Concrete Paving"; the old `32-1313.002–.005` rows are gone; and the Budget Line Items sheet rolls
`32-1313.001` → `32-321313.000` and the `32-1613` group → `32-321613.000`, exactly as you stated.
All 217 Budget Line Items codes are distinct and every one exists in the Procore valid-code list.
The app's catalog still holds the OLD 32-1313 state — that is exactly the drift Phase 2 will fix.
A handful of items need your sign-off (Section 8): five source-sheet lines have no Budget Line Items
formula of their own, the broken `1-10000.000` row needs a decision, and one important correction —
the STEP 3 → STEP 4 link runs in the **opposite direction** from what the plan assumed (details in
Section 5; it makes Phase 3 simpler, not harder).

---

## 2. Expected table — user-confirmed mappings (authoritative)

### B-1 (expected already in sync)

| itemId | Description | Expected rollup |
|---|---|---|
| `03-0000.010` | Amenity Deck Topping Slab and Finished Slab | (division concrete BLI) |
| `03-0000.011` | Post Tension Concrete | (division concrete BLI) |
| `03-0000.012` | Concrete Patios | (division concrete BLI) |
| `03-4500.001` | Precast Architectural Concrete | `3-34500.000` |

### B-2 (reclassification — user-stated as FACT)

| Item | OLD itemId | NEW itemId | NEW rollup |
|---|---|---|---|
| Surmountable Curb | `32-1313.001` | `32-1613.002` | `32-321613.000` |
| B612 Curb | `32-1313.002` | `32-1613.003` | `32-321613.000` |
| Cross Gutter | `32-1313.003` | `32-1613.004` | `32-321613.000` |
| Light Duty Concrete | `32-1313.004` | `32-1613.005` | `32-321613.000` |
| Heavy Duty Concrete | `32-1313.005` | `32-1613.006` | `32-321613.000` |
| Concrete Paving (repurposed slot) | — | `32-1313.001` | `32-321313.000` |

---

## 3. Actual — what the template contains (forensic)

### 3.1 STEP 4 - ESTIMATE rows (32-1313 / 32-1613 block)

| STEP 4 row | Code (col C) | Description (col D) | UoM (G) | Unit price (H) |
|---|---|---|---|---|
| 276 | `32-1313.001` | Concrete Paving | ls | 0 |
| 280 | `32-1613.001` | Site Concrete (parent) | ls | 0 |
| 281 | `32-1613.002` | Surmountable Curb | lf | 29 |
| 282 | `32-1613.003` | B612 Curb | lf | 29 |
| 283 | `32-1613.004` | Cross Gutter | lf | 48 |
| 284 | `32-1613.005` | Light Duty Concrete | sf | 11.5 |
| 285 | `32-1613.006` | Heavy Duty Concrete | sf | 14 |

`32-1313.002–.005` no longer exist anywhere in STEP 4. UoM and prices carried over intact
(Phase 2 re-harvest must preserve these — do not invent values).

### 3.2 Budget Line Items rows touching this block

| BLI row | Procore code (col A) | SUMIF criterion | Criterion resolves to |
|---|---|---|---|
| 199 | `32-321313.000` | STEP 4 `C276` | `32-1313.001` — Concrete Paving |
| 203 | `32-321613.000` | STEP 4 `C280` | `32-1613.001` — Site Concrete (parent only) |

No BLI row references `32-1613.002–.006` directly, and no stale references to the old
`32-1313.002–.005` remain.

### 3.3 DIFF — expected vs. actual

| Check | Result |
|---|---|
| `32-1313.001` repurposed to "Concrete Paving", rolls to `32-321313.000` | ✅ MATCHES user mapping (BLI row 199) |
| `32-1613.002–.006` exist with correct names/uom/prices | ✅ MATCHES |
| `32-1313.002–.005` removed | ✅ MATCHES |
| `32-1613.002–.006` roll to `32-321613.000` | ⚠️ AGREES BY INFERENCE — the only SUMIF for `32-321613.000` references the **parent** `32-1613.001`, not the five children. The harvest's sibling-inference will resolve all five to `32-321613.000` (their only sibling with an authoritative mapping is `.001` → `32-321613.000`), which matches your stated mapping. No SUMIF *disagrees* with you; the SUMIFs simply don't cover the children. → Discrepancy **D1**, needs your sign-off. |
| B-1: `03-4500.001` → `3-34500.000` | ✅ Direct SUMIF (BLI row 81), matches catalog. In sync. |
| B-1: `03-0000.010/.011/.012` | ✅ In sync. No SUMIF of their own (same parent-only pattern); catalog already carries `3-30000.000` via sibling `03-0000.001` (BLI row 78). Descriptions match the catalog exactly. |
| Catalog (`estimate-catalog.json`) vs template | ❌ EXPECTED DRIFT: catalog still has `32-1313.001–.005` as the curb items → `32-321313.000`, and no `32-1613.002–.006`. This is precisely Phase 2's re-sync scope. No action in Phase 1. |

### 3.4 Procore-code validation (§0.D rule 4)

- `src/lib/procore-valid-codes.json` = **224 codes**; cross-checked against the finalized template's
  Importer Data Fields sheet (`sheet18.xml`, column A): **exact match, 224 = 224**. The artifact is current.
- All **217** BLI column-A codes are distinct and **all 217 exist** in the valid-code list. 0 missing.
- Both confirmed rollup targets are valid: `32-321313.000` = "Concrete Paving",
  `32-321613.000` = "Site Concrete".
- BLI row split confirms the plan's counts: **144** STEP-4-sourced + **34** STEP-2-sourced +
  **38** STEP-3-sourced + **1** broken `#REF!` row (`1-10000.000`) = 217.

---

## 4. STEP 2 / STEP 3 BLI SUMIF criteria (the codes Phase 3 must align `constants.ts` to)

Every STEP 2/3-sourced BLI row follows the same pattern:
`SUMIF('<sheet>'!$C$2:$C$60x, '<sheet>'!C<n>, '<sheet>'!$I$2:$I$60x)` — i.e. it sums the source
sheet's **Total** column (I) for the one row whose **Code** column (C) matches.

### 4.1 STEP 2 - GCs → 34 BLI rows

| BLI row | BLI code | Criterion cell | Internal code | Description (STEP 2) | App input today? |
|---|---|---|---|---|---|
| 3 | `1-10001.000` | C19 | `01-0001.001` | Preconstruction Fees | — |
| 4 | `1-10130.000` | C20 | `01-0130.001` | Design - Architecture | — |
| 5 | `1-10160.000` | C21 | `01-0160.001` | Design - Civil | — |
| 6 | `1-10180.000` | C22 | `01-0180.001` | Design - MEP | — |
| 7 | `1-10210.000` | C23 | `01-0210.001` | Design - Structural | — |
| 11 | `1-10310.000` | C27 | `01-0310.001` | Project Executive | staff `01-0310` |
| 12 | `1-10320.000` | C28 | `01-0320.001` | Sr Project Manager | staff `01-0320` |
| 13 | `1-10330.000` | C29 | `01-0330.001` | Project Manager | staff `01-0330` |
| 14 | `1-10340.000` | C30 | `01-0340.001` | Project Engineer | staff `01-0340` |
| 15 | `1-10410.000` | C12 | `01-0410.001` | Sr Superintendent | staff `01-0410` |
| 16 | `1-10420.000` | C13 | `01-0420.001` | Superintendent | staff `01-0420` |
| 17 | `1-10430.000` | C14 | `01-0430.001` | Asst. Superintendent | staff `01-0430` |
| 18 | `1-10510.000` | C31 | `01-0510.001` | Project Assistant | staff `01-0510` |
| 19 | `1-10610.000` | C35 | `01-0610.001` | Safety Consultant *(% of estimate total)* | — |
| 20 | `1-11000.000` | C36 | `01-1000.001` | Small Tools | op `01-1000` |
| 21 | `1-11200.000` | C37 | `01-1200.001` | Fuel and Vehicle Charges | op `01-1200` |
| 22 | `1-11400.000` | C38 | `01-1400.001` | Travel and Meals | — |
| 23 | `1-11600.000` | C39 | `01-1600.001` | Procore *(% of estimate total)* | — |
| 24 | `1-14010.000` | C40 | `01-4010.001` | Quality | — |
| 25 | `1-15110.000` | C41 | `01-5110.001` | Temp Office Set up and Takedown | — |
| 26 | `1-15111.000` | C43 | `01-5111.001` | Cell Phone | op `01-5111` |
| 27 | `1-15112.000` | C44 | `01-5112.001` | Jobsite Office Equipment | — |
| 28 | `1-15114.000` | C45 | `01-5114.001` | Project Computers / Internet | — |
| 29 | `1-15120.000` | C46 | `01-5120.001` | Storage Trailer | — |
| 30 | `1-15130.000` | C47 | `01-5130.001` | Dumpsters | equip `01-5130` |
| 31 | `1-15140.000` | C48 | `01-5140.001` | Temporary Toilets | equip `01-5140` |
| 32 | `1-15150.000` | C49 | `01-5150.001` | Temporary Fire Extinguishers | — |
| 33 | `1-15160.000` | C50 | `01-5160.001` | Temporary Project Signs | — |
| 34 | `1-15170.000` | C51 | `01-5170.001` | Temporary Electric | equip `01-5170` |
| 35 | `1-15180.000` | C52 | `01-5180.001` | Temporary Gas (not winter heat) | — |
| 36 | `1-15190.000` | C53 | `01-5190.001` | Temporary Water | — |
| 37 | `1-16010.000` | C54 | `01-6010.001` | Courier services | — |
| 38 | `1-16020.000` | C55 | `01-6020.001` | Plan Reproduction | — |
| 39 | `1-17010.000` | C56 | `01-7010.001` | Legal Fees | — |

**Unreferenced STEP 2 item (no BLI SUMIF):** `01-5110.002` "Temp Office" (monthly, row 42).
Criteria jump C41 → C43. → Discrepancy **D2a**.

### 4.2 STEP 3 - SITE OPS → 38 BLI rows

| BLI row | BLI code | Criterion cell | Internal code | Description (STEP 3) | App input today? |
|---|---|---|---|---|---|
| 40 | `2-23200.000` | C12 | `02-3200.001` | Soil Borings | manual `02-3200` |
| 41 | `2-24100.000` | C32 | `02-4100.001` | Demolition | — |
| 42 | `2-25100.000` | C13 | `02-5100.001` | FFE Relocation | — |
| 43 | `2-28213.000` | C14 | `02-8213.001` | Abatement | — |
| 44 | `2-29005.000` | C38 | `02-9005.001` | Final Cleaning | — |
| 45 | `2-29010.000` | C15 | `02-9010.001` | Progress Cleaning - Payroll | manual `02-9010` (payroll) |
| 46 | `2-29015.000` | C17 | `02-9015.001` | Safety | dynamic `02-9015` |
| 47 | `2-29020.000` | C18 | `02-9020.001` | Temp Protection | dynamic `02-9020` |
| 48 | `2-29025.000` | C19 | `02-9025.001` | Temporary Partitions | — |
| 49 | `2-29030.000` | C20 | `02-9030.001` | Traffic Control and Jersey Barriers | — |
| 50 | `2-29035.000` | C21 | `02-9035.001` | Temporary Fencing | — |
| 51 | `2-29040.000` | C22 | `02-9040.001` | Scrim | — |
| 52 | `2-29045.000` | C23 | `02-9045.001` | Temp Access Roads | — |
| 53 | `2-29050.000` | C24 | `02-9050.001` | Site Security | — |
| 54 | `2-29055.000` | C25 | `02-9055.001` | Site Security Cameras | — |
| 55 | `2-29060.000` | C26 | `02-9060.001` | Jobsite Camera | — |
| 56 | `2-29065.000` | C27 | `02-9065.001` | Construction Permits (not building permit) | — |
| 57 | `2-29070.000` | C43 | `02-9070.001` | SWPPP Permit | — |
| 58 | `2-29200.000` | C48 | `02-9200.001` | Survey & Layout | — |
| 59 | `2-29305.000` | C54 | `02-9305.001` | City Requirements | — |
| 60 | `2-29307.000` | C55 | `02-9307.001` | Knox Box | manual `02-9307` |
| 61 | `2-29310.000` | C56 | `02-9310.001` | Permanent Power Service | — |
| 62 | `2-29315.000` | C57 | `02-9315.001` | Temporary Power Service | — |
| 63 | `2-29320.000` | C58 | `02-9320.001` | Gas Service | — |
| 64 | `2-29325.000` | C59 | `02-9325.001` | Cable Service | — |
| 65 | `2-29330.000` | C60 | `02-9330.001` | Data Service | — |
| 66 | `2-29405.000` | C65 | `02-9405.001` | Material Hoist / Trash Chute | dynamic `02-9405` |
| 67 | `2-29410.000` | C66 | `02-9410.001` | Scaffolding & Platforms | — |
| 68 | `2-29415.000` | C67 | `02-9415.001` | Crane Rental | — |
| 69 | `2-29420.000` | C68 | `02-9420.001` | Equipment Rental | — |
| 70 | `2-29425.000` | C69 | `02-9425.001` | Forklift Rental | — |
| 71 | `2-29430.000` | C70 | `02-9430.001` | Street Sweeping | — |
| 72 | `2-29505.000` | C75 | `02-9505.001` | Construction Materials Testing | — |
| 73 | `2-29510.000` | C76 | `02-9510.001` | Vibration Monitoring | — |
| 74 | `2-29515.000` | C77 | `02-9515.001` | Acoustic Testing | — |
| 75 | `2-29520.000` | C78 | `02-9520.001` | Window Testing | — |
| 76 | `2-29525.000` | C79 | `02-9525.001` | Weather Barrier Testing | — |
| 77 | `2-29530.000` | C80 | `02-9530.001` | Gypcrete Testing | — |

**Unreferenced STEP 3 items (no BLI SUMIF):**
- `02-9010.002` "Progress Cleaning - Hired" (row 16) — *the app HAS this line* (`InfrastructureStep.tsx`,
  currently coded `02-9010` same as payroll) → Discrepancy **D2b**
- `02-4100.002` "Demolition - Sawcutting" (row 33) → **D2c**
- `02-9200.002` "Survey & Layout - Floor Scanning" (row 49) → **D2d**

---

## 5. STEP 3 → STEP 4 dependency map (§0.C) — direction CORRECTED

**Key finding: the plan's §0.C assumption is backwards.** No Site Ops dollars flow
STEP 3 → STEP 4 → BLI. The actual links:

1. **STEP 4 pulls FROM STEP 2/3** — the Division 01/02 lines in STEP 4 (rows 12–24) take their
   unit price (col H) from STEP 2/3 **subtotal** cells. These STEP 4 lines feed only the STEP 4
   estimate grand total (I331/I341) — **no BLI row references STEP 4 rows 12–24**, so there is no
   double-counting in the BLI and **no BLI write-order dependency**.
2. The only STEP 3 → STEP 4 formulas are header metadata (bid date, durations, sqft: I2/J2/J3/J4/J8).

### 5.1 The pull map (STEP 4 ← STEP 2/3)

| STEP 4 row | STEP 4 code | Description | Col H pulls from | Source cell meaning | Col S sanity-check vs |
|---|---|---|---|---|---|
| 12 | `01-0000.001` | General Conditions | STEP 2 `I58` | Total Design, PM and GCs = SUM(I18:I57) | `I58` ✅ |
| 13 | `01-0400.002` | Supervision | STEP 2 `I16` | Total Supervision = SUM(I11:I15) | `I16` ✅ |
| 17 | `02-0000.001` | Site Operations | STEP 3 `I29` | Total Site Operations = SUM(I11:I28) | `I29` ✅ |
| 18 | `02-4100.002` | Demolition | STEP 3 `I35` | Total Demolition = SUM(I31:I34) | `I35` ✅ |
| 19 | `02-9005.003` | Final Cleaning | STEP 3 `I38` | ⚠️ single line, not subtotal `I40` | `I40` ⚠️ mismatch |
| 20 | `02-9070.004` | SWPPP Permit | STEP 3 `I43` | ⚠️ single line, not subtotal `I45` | `I45` ⚠️ mismatch |
| 21 | `02-9200.005` | Survey and Layout | STEP 3 `I51` | Total Survey and Layout = SUM(I47:I50) | `I51` ✅ |
| 22 | `02-9300.006` | Building and Site Services | STEP 3 `I62` | Total Building and Site Services | `I62` ✅ |
| 23 | `02-9400.007` | Site Equipment | STEP 3 `I72` | Total Site Equipment | `I72` ✅ |
| 24 | `02-9500.008` | Special Inspections | STEP 3 `I81` | ⚠️ **a blank spare row** — always $0; subtotal is `I82` | `I82` ⚠️ mismatch |

The three ⚠️ rows are legacy template bugs (advisory only — the app overwrites these in Phase 3).
The **intended** sources, per the col-S checks and subtotal structure, are: I40 (Final Cleaning),
I45 (SWPPP), I82 (Special Inspections). Recorded as Discrepancy **D4**; no user decision needed —
the app computes these totals itself.

### 5.2 Reverse links worth knowing for Phase 3 (template-internal circularity)

- STEP 2 `H35` (Safety Consultant) and `H39` (Procore) are **% of estimate grand total** lines:
  `L35 = 'STEP 4 - ESTIMATE'!$I$341` is shown to the estimator, who manually types the amount into
  `H35` ("Enter this amount in column H when estimate complete") — the template breaks the
  GC→total→GC circularity by hand. The app's GC calculation must decide how to feed
  `01-0610.001` / `01-1600.001` (currently no app input lines exist for them).
- STEP 2 `I61` "GCs by %" = `(I16+I58)/'STEP 4 - ESTIMATE'!I331` — display only, no BLI impact.

### 5.3 Phase 3 write-order conclusion

**There is no cross-sheet write-order constraint for the BLI.** Each of the 217 BLI rows can be
written independently from the app's combined rollup (STEP 4 line items + GC lines + Site Ops lines)
because no BLI row depends on another sheet's computed cell once the app writes values. The §6 caveat
in the plan can be dropped; the simple "match criterion code → write value" loop is sufficient.

---

## 6. App-side code alignment list (input to Phase 3 — no changes made now)

Template criteria all carry a `.001`-style suffix; app constants are currently suffix-less.
Phase 3 must align these (per plan §4/§5):

| App source | Current code | Template criterion |
|---|---|---|
| `STAFF_ROLE_DEFAULTS` (×8) | `01-0310` … `01-0510` | `01-0310.001` … `01-0510.001` (same stems) |
| `OPERATIONAL_EXPENSE_DEFAULTS` | `01-1000`, `01-1200`, `01-5111` | `01-1000.001`, `01-1200.001`, `01-5111.001` |
| `PersonnelPricingStep.tsx` equipment | `01-5130`, `01-5140`, `01-5170` | `01-5130.001`, `01-5140.001`, `01-5170.001` |
| `InfrastructureStep.tsx` dynamic | `02-9015`, `02-9020`, `02-9405` | `02-9015.001`, `02-9020.001`, `02-9405.001` |
| `InfrastructureStep.tsx` manual | `02-9307`, `02-9010` (payroll), `02-9010` (hired), `02-3200` | `02-9307.001`, `02-9010.001`, `02-9010.002` ⚠️ (no BLI row — see D2b), `02-3200.001` |

GC/Site Ops BLI rows with **no app input line today** (would export $0 until inputs exist —
Phase 3/4 scope decision, listed for completeness):
- STEP 2 (20 of 34): `01-0001.001`, `01-0130.001`, `01-0160.001`, `01-0180.001`, `01-0210.001`,
  `01-0610.001`, `01-1400.001`, `01-1600.001`, `01-4010.001`, `01-5110.001`, `01-5112.001`,
  `01-5114.001`, `01-5120.001`, `01-5150.001`, `01-5160.001`, `01-5180.001`, `01-5190.001`,
  `01-6010.001`, `01-6020.001`, `01-7010.001`
- STEP 3 (32 of 38): all except `02-3200.001`, `02-9010.001`, `02-9015.001`, `02-9020.001`,
  `02-9307.001`, `02-9405.001`

---

## 7. Inputs Phase 2 needs (recorded here so Phase 2 can run from this doc)

1. Template state verified at `4eab1f1`; `npm run sync-codes` will harvest: `32-1313.001` desc →
   "Concrete Paving" (rollup unchanged, authoritative via BLI row 199); `32-1313.002–.005` drop out;
   `32-1613.002–.006` appear and resolve to `32-321613.000` **via sibling inference** (their parent
   `.001` is the authoritative criterion) — pending D1 sign-off below.
2. UoM/prices to preserve (from §3.1): `.002` lf/29, `.003` lf/29, `.004` lf/48, `.005` sf/11.5, `.006` sf/14.
3. Migration scope unchanged from plan §0.B: INSERT `32-1613.002–.006`, UPDATE `32-1313.001`
   description, DELETE `32-1313.002–.005`; then surface existing `estimate_line_items` on
   `32-1313.001–.005` for user review.
4. `procore-valid-codes.json` is current (matches finalized template Importer sheet, 224 codes) —
   re-harvest should produce no valid-code churn.

---

## 8. DISCREPANCY LIST — for user sign-off

Per §0.D: your mapping wins; nothing below was auto-resolved. Items D1–D3 need a decision;
D4–D6 are recorded for the record (no decision required).

| # | Finding | Proposed resolution (Recommended) | Needs sign-off? |
|---|---|---|---|
| **D1** | `32-1613.002–.006` have **no BLI SUMIF of their own**; the only Site Concrete SUMIF references parent `32-1613.001`. Your stated rollup (`→ 32-321613.000`) will be applied via sibling inference at harvest — the SUMIFs don't contradict you, they just don't cover the children. | Accept sibling inference: all five → `32-321613.000` (matches your stated mapping exactly). | ✅ YES |
| **D2a–d** | Four source-sheet lines have **no BLI row at all** (their dollars would vanish from the Procore rollup): **a)** `01-5110.002` Temp Office (monthly); **b)** `02-9010.002` Progress Cleaning - Hired — *the app has this input line*; **c)** `02-4100.002` Demolition - Sawcutting; **d)** `02-9200.002` Survey & Layout - Floor Scanning. | Map each to its sibling's BLI code: a→`1-15110.000`, b→`2-29010.000`, c→`2-24100.000`, d→`2-29200.000`. (b matters most — hired-cleaning dollars need a home in Phase 3.) | ✅ YES |
| **D3** | BLI row 2 `1-10000.000` "General Conditions" is the known `#REF!`-broken row. Its dollars are already fully represented by the 34 granular GC rows — writing the GC total here would **double-count** GC dollars in Procore. | Phase 3 writes **$0** to this row (granular rows carry the dollars). | ✅ YES |
| **D4** | Legacy STEP 4 formula bugs: H19 pulls `I38` (line, not subtotal `I40`); H20 pulls `I43` (not `I45`); H24 pulls `I81` (a **blank row** — Special Inspections always $0 in the template today). The col-S sanity checks point at the correct subtotals. | None needed — app computes these totals itself and overwrites in Phase 3. Recorded as advisory bugs. | record only |
| **D5** | Catalog/`cost_code_map` still hold the OLD `32-1313.001–.005` curb state and lack `32-1613.002–.006`. | Expected drift — this is Phase 2's scope (plan §0.B). | record only |
| **D6** | Cosmetic description drift between Importer Data Fields and source sheets (e.g., "Safety Consultant, Visit Bi-Weekly" vs "Safety Consultant"; "Temp Office and Set up" vs "Temp Office Set up and Takedown"; "Const Materials Testing" vs "Construction Materials Testing"). Codes match in all cases. | None — codes are the join key. | record only |

**Not discrepancies (verified clean):** B-1 codes in sync (§3.3); all 217 BLI codes valid + distinct;
valid-code artifact current; no stale `32-1313.002–.005` references; no BLI double-count path;
the plan's 144/34/38/1 row counts confirmed exactly.

---

## 9. USER SIGN-OFF (2026-06-05)

All three decision items approved by the user (System Architect) at Phase 1 close:

| # | Decision |
|---|---|
| **D1** | ✅ APPROVED — `32-1613.002–.006` all roll up to `32-321613.000` Site Concrete (sibling inference matches the stated mapping). |
| **D2** | ✅ APPROVED (all 4) — orphan lines map to their sibling's BLI code: `01-5110.002`→`1-15110.000`, `02-9010.002`→`2-29010.000`, `02-4100.002`→`2-24100.000`, `02-9200.002`→`2-29200.000`. These are user-confirmed mappings — Phase 2/3 may encode them without re-asking. |
| **D3** | ✅ APPROVED — Phase 3 writes **$0** to the broken `1-10000.000` BLI row (row 2); the 34 granular GC rows carry the dollars. |

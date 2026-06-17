# Template + Catalog Reconciliation — Phase 3 Cost-Type Disposition Report
_Generated 2026-06-12 by `npm run type-disposition` — regenerate after any catalog or master-list change._

## What this is
Each of the STEP-4 cost-type mismatches (the advisory pinned in
`procore-type-reconciliation.test.ts`): the estimate code, its mapped Procore base,
both types, and the proposed correction. **Mechanical type fixes** get a
`catalog_cost_type_overrides` row (`cost_type` = Procore's type — label-only, moves
no dollars). **Suspected wrong-code mis-maps** are NOT touched: repointing a code
moves dollars and is explicitly out of scope (plan §Out of scope); they remain in
the advisory as the explained residual, awaiting a separate architect review.

## Summary

| Metric | Count |
| --- | --- |
| Procore master-list codes | 217 |
| Type mismatches (advisory) | 67 |
| → Mechanical type fixes (seeded) | 65 |
| → Suspected wrong-code mis-maps (NOT touched) | 2 |
| Mechanical flip S→M | 38 |
| Mechanical flip M→S | 26 |
| Mechanical flip S→E | 1 |

> Only ONE mismatch resolves to Equipment (`10-2113.001` Toilet Partitions → E).
> The Equipment vocabulary (Phase 1) was still required — without it that code
> could never agree — but the bulk of the 67 are Material↔Subcontract flips.

## Suspected wrong-code mis-maps (architect review — NOT seeded)

### `01-0400.002` — Supervision

Maps to `1-10000.000` General Conditions (Material); estimate type L (Labor).

Supervision (typed L, $43,300 default) maps to `1-10000.000` General Conditions (Material). The Procore master list has FIVE dedicated Labor supervision codes (`1-10410.000` Sr Superintendent, `1-10420.000` Superintendent, `1-10430.000` Asst. Superintendent, plus the 1-103xx PM ladder). Relabeling this line M would bury supervision labor inside the GC material bucket; it likely belongs on one of the 1-104xx Labor codes instead.

### `12-3530.002` — Residential Casework - Installation

Maps to `12-123530.000` Residential Casework (Material); estimate type S (Subcontract).

Residential Casework - Installation (typed S) maps to `12-123530.000` Residential Casework (Material) — the same code as its sibling `12-3530.001` "- Material" (M, which agrees). The catalog deliberately splits material vs installation; Procore types the shared code Material, so relabeling the INSTALLATION line M would mislabel subcontracted install work. A better-fitting existing code is `6-62000.000` Finish Carpentry Installation (Subcontract). Architect to decide: repoint, or accept the Material label on the install half.

## Mechanical type fixes (seeded into `catalog_cost_type_overrides`)

| Internal code | Catalog description | Procore code | Procore description | Fix |
| --- | --- | --- | --- | --- |
| `01-0000.001` | General Conditions | `1-10000.000` | General Conditions | S (Subcontract) → M (Material) |
| `01-0230.001` | Building Permit | `1-10230.000` | Building Permit | S (Subcontract) → M (Material) |
| `01-0230.002` | SAC Determination | `1-10260.000` | City Licenses/Misc Permits | S (Subcontract) → M (Material) |
| `01-0250.001` | Demolition Permit | `1-10250.000` | Demolition Permit | S (Subcontract) → M (Material) |
| `01-0260.001` | City Licenses and Misc Permits | `1-10260.000` | City Licenses/Misc Permits | S (Subcontract) → M (Material) |
| `03-0000.012` | Concrete Patios | `3-30000.000` | Concrete | M (Material) → S (Subcontract) |
| `03-4100.001` | Precast Structural Concrete | `3-34100.000` | Precast Structural Concrete | M (Material) → S (Subcontract) |
| `03-4500.001` | Precast Architectural Concrete | `3-34500.000` | Precast Architectural Concrete | M (Material) → S (Subcontract) |
| `04-0000.001` | Masonry | `4-40000.000` | Masonry | M (Material) → S (Subcontract) |
| `05-1200.001` | Structural Steel | `5-51200.000` | Structural Steel | M (Material) → S (Subcontract) |
| `05-5000.001` | Metal Fabrications | `5-55000.000` | Metal Fabrications | S (Subcontract) → M (Material) |
| `06-1000.001` | Rough Carpentry Materials (Loose and Joists) | `6-61000.000` | Rough Carpentry Material | S (Subcontract) → M (Material) |
| `06-1710.001` | Manufactured Wall Panels | `6-61710.000` | Manufactured Wall Panels | S (Subcontract) → M (Material) |
| `06-1753.001` | Shop-Fabricated Wood Trusses | `6-61753.000` | Wood Trusses | S (Subcontract) → M (Material) |
| `06-1800.001` | Glu-Laminated Construction | `6-61800.000` | Glu-Laminated Construction | S (Subcontract) → M (Material) |
| `06-2000.002` | Finish Carpentry Installation - Doors | `6-62000.000` | Finish Carpentry Installation | M (Material) → S (Subcontract) |
| `06-2200.003` | Millwork | `6-62200.000` | Millwork | S (Subcontract) → M (Material) |
| `06-7300.001` | Composite Decking | `6-67300.000` | Composite Decking | S (Subcontract) → M (Material) |
| `06-8316.001` | FRP Wall Paneling | `6-68316.000` | FRP Wall Paneling | S (Subcontract) → M (Material) |
| `07-2500.001` | Weather Barriers | `7-72500.000` | Weather Barriers | M (Material) → S (Subcontract) |
| `07-2700.001` | Spray-Applied Air Barriers | `7-72700.000` | Spray-Applied Air Barriers | M (Material) → S (Subcontract) |
| `07-3113.001` | Asphalt Shingles | `7-73113.000` | Asphalt Shingles | M (Material) → S (Subcontract) |
| `08-3613.001` | Overhead and Coiling Doors | `8-83613.000` | Overhead and Coiling Doors | M (Material) → S (Subcontract) |
| `08-4000.002` | Aluminum Storefront Doors | `8-84000.000` | Aluminum Entrances and Storefronts | M (Material) → S (Subcontract) |
| `08-5113.001` | Aluminum Windows and Patio Doors | `8-85113.000` | Aluminum Windows and Patio Doors | M (Material) → S (Subcontract) |
| `08-8700.001` | Window Film | `8-88700.000` | Window Film | M (Material) → S (Subcontract) |
| `09-2216.002` | Steel Stud Metal Framing | `9-92216.000` | Steel Stud Metal Framing | M (Material) → S (Subcontract) |
| `10-0000.001` | Specialties | `10-100000.000` | Specialties | S (Subcontract) → M (Material) |
| `10-2113.001` | Toilet Partitions | `10-102113.000` | Toilet Partitions | S (Subcontract) → E (Equipment) |
| `10-2213.002` | Wire Mesh Storage Cages | `10-102213.000` | Wire Mesh Storage Cages | S (Subcontract) → M (Material) |
| `10-2800.001` | Toilet and Bath Accessories | `10-102800.000` | Toilet and Bath Accessories | S (Subcontract) → M (Material) |
| `10-2819.001` | Tub and Shower Doors | `10-102819.000` | Tub and Shower Doors | M (Material) → S (Subcontract) |
| `10-3110.002` | Outdoor Fire Pits | `10-103110.000` | Outdoor Fire Pits | M (Material) → S (Subcontract) |
| `10-4413.001` | Fire Extinguishers and Cabinets | `10-104413.000` | Fire Extinguishers and Cabinets | S (Subcontract) → M (Material) |
| `10-5100.001` | Lockers | `10-105100.000` | Lockers | S (Subcontract) → M (Material) |
| `10-5500.001` | Postal Specialties | `10-105500.000` | Postal Specialties | S (Subcontract) → M (Material) |
| `10-5500.002` | Package Concierge | `10-105500.000` | Postal Specialties | S (Subcontract) → M (Material) |
| `11-1313.001` | Loading Dock Equip | `11-111313.000` | Loading Dock Equipment | S (Subcontract) → M (Material) |
| `11-2423.001` | Window Washing System | `11-112423.000` | Window Washing System | M (Material) → S (Subcontract) |
| `11-3100.001` | Appliances | `11-113100.000` | Appliances | S (Subcontract) → M (Material) |
| `11-4000.001` | Food Service Equipment | `11-114000.000` | Food Service Equipment | S (Subcontract) → M (Material) |
| `12-2000.001` | Window Treatments | `12-122000.000` | Window Treatments | M (Material) → S (Subcontract) |
| `12-3663.001` | Window Sills | `12-123663.000` | Window Sills | M (Material) → S (Subcontract) |
| `12-4000.001` | Furnishings and Accessories | `12-124000.000` | Furnishings and Accessories | S (Subcontract) → M (Material) |
| `13-1900.001` | Pet Equipment | `13-131900.000` | Pet Equipment | S (Subcontract) → M (Material) |
| `32-1313.001` | Concrete Paving | `32-321313.000` | Concrete Paving | M (Material) → S (Subcontract) |
| `32-1316.001` | Decorative Concrete Paving | `32-321316.000` | Decorative Concrete Paving | M (Material) → S (Subcontract) |
| `32-1343.001` | Pervious Concrete Paving | `32-321343.000` | Pervious Concrete Paving | M (Material) → S (Subcontract) |
| `32-1613.001` | Site Concrete | `32-321613.000` | Site Concrete | M (Material) → S (Subcontract) |
| `32-1613.005` | Light Duty Concrete | `32-321613.000` | Site Concrete | M (Material) → S (Subcontract) |
| `32-1613.006` | Heavy Duty Concrete | `32-321613.000` | Site Concrete | M (Material) → S (Subcontract) |
| `32-1613.007` | Concrete Curb Stops | `32-321613.000` | Site Concrete | M (Material) → S (Subcontract) |
| `50-2000.001` | Winter Conditions | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.002` | Temp Enclosures | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.003` | Temp Heaters | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.004` | Temp Gas | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.005` | Wiring for Temp Heaters | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.006` | Temp Gas Piping | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `50-2000.008` | Snow Removal | `50-502000.000` | Winter Conditions | S (Subcontract) → M (Material) |
| `80-8001.001` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |
| `80-8002.002` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |
| `80-8003.003` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |
| `80-8004.004` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |
| `80-8005.005` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |
| `80-8006.006` | TBD | `80-800001.000` | Miscellaneous 1 | S (Subcontract) → M (Material) |

## Method / reproducibility
- Mismatch set = the same catalog-vs-master-list walk the pin test runs
  (`src/lib/estimate-catalog.json` × `docs/reference/Procore Cost Codes.xlsx`).
- The mis-map split is a hand review encoded in `SUSPECTED_MISMAPS`
  (`scripts/catalog-type-disposition.js`) so the report regenerates deterministically.
- Seeding (`scripts/seed-cost-type-overrides.js`) requires `computeDisposition()` from
  this script — the seeded rows are the mechanical list by construction.
- Re-run: `npm run type-disposition`.

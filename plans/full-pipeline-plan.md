# XoomPark Full Pipeline Plan

The complete flow: **Sourcing → Enrichment → Qualification → Outreach → Deal.**

```
HUNT → INGEST → ENRICH → CHECKLIST → RESEARCH → EMAIL → CALL → PROMOTE → DEAL
└──────────────┘  └──────────────────────┘  └──────────────────────────────┘
   SOURCING           QUALIFICATION              OUTREACH + DEAL
```

---

## Phase 1 — Sourcing (Discovery + Ingestion)

**Goal:** find lots that aren't in the system, get them in as `draft` records.

### 1a. Hunt (discovery)

Locality-by-locality discovery of new lots.

- **Sources:** 5 aggregators (SpotHero, Parkopedia, BestParking, ParkWhiz, ParkMe) + official sources (SFMTA, city sites, port authorities).
- **Existing:** `HuntTrack` component, `huntLinks.ts` (verified deep links per locality), Source Registry modal.
- **Flow:** pick locality → open aggregator deep link → find lots → add to system.

### 1b. Ingestion (scrape → parse → dedup → import)

Three entry points (all exist today):

| Entry | Flow |
|-------|------|
| Manual add | form → validate → `upsertSourcedLocation` |
| Paste URL | fetch → classify (SpotHero/Parkopedia) → parse → dedup-tag → import |
| Paste HTML | regex extract → dedup-tag → import |

- **Dedup:** `computeDedupeKey` (source + listing_id, or normalized address). Cross-source matching (SpotHero vs Parkopedia) via `findCrossSourceMatches` + `mergeSourcedLocations`.
- **Result:** a `parking_lots` doc with `status: 'draft'`, `captured_by: 'scraped'`, raw fields from the listing.

### 1c. What's missing in Sourcing

- **Operator detection at ingest** — when a lot is scraped, detect the operator (from listing, domain, or name pattern) and link `company_account_id` immediately. Today this is manual/absent.
- **Auto-disqualification at ingest** — if a scraped lot has `stall_count < 20` or `clearance < 7ft`, mark `disqualified` at ingest instead of letting it sit in the queue.

---

## Phase 2 — Enrichment (Data Filling)

**Goal:** fill the lot's fields from external sources so the BDR doesn't research from scratch.

### 2a. What enrichment exists today (scripts, not real-time)

| Enrichment | Source | Fields | Feeds |
|-----------|--------|--------|-------|
| Geo | FEMA NFHL + OSM | floodZone, floodHazardArea, residentialAdjacent, demand distances | hard filters |
| EV | AFDC/NLR | onSiteDcFastPorts, onSiteLevel2Ports, nearestDcFastMi | services/resources |
| Amenity | OSM | nearestCarWashM, nearestCarServiceM | services/resources |
| Pitstop | OSM | osmId, osmType, storageScore, stagingScore, capacity, owner | checklist + account |
| Corporate | Sunbiz/LBT | entityName, documentNumber, registeredAgent, authorizedPersons | **company_accounts** |
| Business license | LBT | businessName, ownerName, phone, email, classCode | **company_accounts** |
| Parcel | county | folio, ownerOfRecord, ownerMailingAddress, zoning | **company_accounts** |
| Gate | source | claims, derivedGateType | checklist |

### 2b. The enrichment → account layer connection (the key new piece)

Enrichment already surfaces the operator/owner signals. The plan wires them into `company_accounts`:

```
parcel.ownerOfRecord ─┐
business_license.owner ─┤
corporate_entity.name ──┼──→ company_accounts (dedup by domain/name)
pitstop.owner ──────────┘
contact email domain ───┘
```

- **Auto-candidate:** enrichment creates `organization_candidates` (unconfirmed).
- **BDR confirms:** "these 7 lots belong to Laz Parking" → link `parking_lots.company_account_id`.
- **Result:** one operator entity, linked lots, no duplicate outreach.

### 2c. What's missing in Enrichment

- **AI enrichment** — the reference site says "full AI enrichment is not connected yet." The target: AI fills address, owner/operator, facility type, spaces, hours, access, PUDO, staging, accessibility, contact routes.
- **Real-time trigger** — today enrichment is batch scripts. The plan: trigger on ingest (new lot → enrich geo/ev/amenity immediately), and on-demand (BDR clicks "enrich this lot").
- **Enrichment → checklist auto-fill** — enriched fields should pre-fill the checklist so the BDR confirms instead of researching from scratch.

---

## Phase 3 — Qualification (Checklist + Gate)

**Goal:** decide if a lot is worth outreach.

### 3a. The 7-field checklist (exists)

capacity (50+ stalls), 24/7, fenced, lit, ingress/egress, clearance, rates/hours.

### 3b. The gate (new)

```
Sourced lot (draft)
    │
    ▼
Checklist assessment
    │
    ├── Hard disqualifier: stall_count < 20  →  DISQUALIFIED (undersized)
    ├── Hard disqualifier: clearance < 7'0"  →  DISQUALIFIED (low_clearance)
    │
    └── Meets MVQ (stalls ≥ 20 + locality confirmed)  →  QUALIFIED → Research Desk
```

- Soft fields (lit, fenced, 24/7, ingress/egress) enrich during research or confirm during calls.
- Checklist is a **completeness signal**, not a stage. `Research 6/7` vs `Research 7/7`.

---

## Phase 4 — Outreach (Research → Email → Call)

**Goal:** find the decision-maker, start the conversation, qualify.

### 4a. Research Desk (queue-first)

- **Entry:** `status == 'saved'` AND not disqualified AND no contact_email/phone.
- **One-at-a-time wizard** (like Work Queue). Search is a toggle.
- **Exit:** contact found → BDR Email/SDR Call; uncontactable → UNREACHABLE; closed → DISQUALIFIED.

### 4b. BDR Email Queue

- `outreach.status == 'ready' | 'sent'`.
- Batch email + follow-up cadence. `next_touch_at` schedules +3 business days.

### 4c. SDR Call Queue

- `outreach.status == 'called'` AND `next_touch_at <= NOW()`.
- Dialing queue with script, notes, disposition buttons.

### 4d. Response disposition (new)

Split `responded` into:
- `interested` → promote to deal
- `not_interested` → archive with snooze
- `out_of_office` / `wrong_contact` → back to Research Desk

---

## Phase 5 — Deal (Promotion + Pipeline)

**Goal:** turn a qualified conversation into a signed deal.

### 5a. Promotion bridge

- **Trigger:** `responded` (buyer signal) → prospect `QUALIFYING`; `quoted` → `PROPOSAL`.
- **Field mapping:** companyName (from enrichment/account), contact (from outreach), providerDetails (from lot), `associatedLotIds: [lot.id]`.
- **Bridge record:** `lotProspectLinks` (lot_id, prospect_id, promoted_at, promoted_by, snapshots) for conversion analytics.

### 5b. Pipeline Kanban

- Only `bdProspects` (QUALIFYING → LIVE/LOST). Never the 967 lots.
- **Portfolio deals:** `deal_type: 'portfolio_master_agreement'`, `associated_lot_ids[]`, `total_stalls_in_deal`. One card = "SP+ Master Agreement, 480 stalls."

### 5c. Cold-outreach lockout

- If `company_accounts.active_deal_id` exists, all other lots under that account show "⚠️ locked — in-flight deal."

---

## End-to-End Data Flow

```
Hunt (find lot)
  → ingest (scrape/parse/dedup) → parking_lots (draft)
  → enrich (geo/ev/amenity/pitstop/corporate/parcel)
      ├→ fills checklist fields
      └→ creates company_accounts + contacts (operator layer)
  → checklist gate (hard disqualifiers)
  → Research Desk (find decision-maker) → outreach (contact found)
  → BDR Email (sent) → SDR Call (called)
  → responded (buyer signal) → PROMOTE
  → bdProspects (QUALIFYING) + lotProspectLinks
  → Kanban (QUALIFYING → PROPOSAL → NEGOTIATING → ONBOARDING → LIVE)
```

---

## Build Order (full pipeline, ranked)

| # | Step | Phase | Leverage |
|---|------|-------|----------|
| 1 | `company_accounts` + `contacts` collections + link fields | Enrichment | Highest — unlocks grouping, portfolio, lockout |
| 2 | Operator detection at ingest + auto-link | Sourcing | Prevents duplicate outreach from day 1 |
| 3 | Mutations (write path) | Outreach | Makes it a pipeline, not a dashboard |
| 4 | `createProspectFromLot` bridge | Deal | Connects sourcing to revenue |
| 5 | Score-based priority + SLA (`next_touch_at`) | Outreach | Makes My Day actually useful |
| 6 | Hard disqualifiers at ingest + checklist gate | Qualification | Keeps junk out of the queue |
| 7 | Research Desk queue (one-at-a-time) | Outreach | Drives systematic research |
| 8 | BDR Email + SDR Call queues (SLA highlight) | Outreach | Batch execution |
| 9 | Response disposition triage | Outreach | Correct routing of replies |
| 10 | Portfolio deals + lockout | Deal | Operator-centric selling |
| 11 | Site Intelligence (3 tabs + conversion analytics) | All | Visibility |
| 12 | Archived split + off-ramps | All | Hygiene |
| 13 | AI enrichment (connect the "not connected yet") | Enrichment | Fills data automatically |
| 14 | Team & Workflow (cadence settings) | All | Config |

---

## Design System (reference)

- Dark sidebar `#192b33`, lime `#caf28a`, green `#167456`, light bg `#f6f8fa`
- Border radius 4px, no heavy shadows, Geist fonts
- No "San Francisco" — use "All markets"
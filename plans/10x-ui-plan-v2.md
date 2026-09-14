# XoomPark Outreach Desk — 10x UI Plan v2 (expert-reviewed)

Two expert reviews folded in. Key corrections: queues = throughput, pipeline = visibility; Work Queue becomes a dense matrix not a paginated wizard; Research Desk becomes split-pane; Connections Bar becomes a 32px ribbon; portfolio cards become expandable containers.

---

## Core principle (corrected)

```
Queues  = one thing at a time (throughput)
Pipeline = many things at once (visibility)
```

Different UX problems, different patterns.

---

## 1. Work Queue — "Dense Matrix, Single Active Cursor"

**Not a paginated wizard.** All 7 fields visible at once, cursor on the first unverified field.

```
┌────────────────────────────────────────────────────────────────────────┐
│ 150 Division St · Surface Lot · Target: Amazon Rivian EDV             │
├────────────────────────────────────────────────────────────────────────┤
│ [1] Stalls       │ 54 stalls (SpotHero)         │ [✓ Confirmed]  (Auto) │
│ [2] Access 24/7  │ Unknown                      │ [ ? Needs Review ] ◄ │
│ [3] Fenced       │ "Fully perimeter chain-link" │ [Y] Yes  [N] No [S]  │
│ [4] Lit          │ Scraped: "High-mast LEDs"    │ [Y] Yes  [N] No [S]  │
│ [5] Ingress      │ 1 curb-cut on Division St    │ [Y] Yes  [N] No [S]  │
│ [6] Clearance    │ Open sky (Uncovered)         │ [✓ Confirmed]        │
│ [7] Rates        │ $175/mo (SpotHero)           │ [✓ Confirmed]        │
└────────────────────────────────────────────────────────────────────────┘
```

- **All context visible** — clearance is judged with lot type in view (no isolated-card mistakes).
- **Y/N/S saves the row and moves the cursor** — zero page reflow, ~4s per lot.
- **Confidence inline:** `54 stalls (SpotHero) HIGH CONFIDENCE` vs `~120 stalls (derived) LOW CONFIDENCE`. Humans trust green checkmarks too much.
- **Source inline, not collapsed:** the value shows its source right under it.
- **"Why it matters" killed** from the workspace → moved to onboarding drawer (`Shift + ?`).
- **Source ladder → functional hotlinks** bound to number keys: `[1] SpotHero ↗ [2] Google Maps ↗ [3] County GIS ↗`. Tapping `2` opens a side-drawer with Street View centered on the lot.

---

## 2. Research Desk — Split-Pane Master-Detail

**Not a strict one-at-a-time queue.** A split screen (Superhuman/Linear pattern).

```
┌──────────────────────────┬─────────────────────────────────────────────┐
│ RESEARCH QUEUE (42)      │ CURRENT LOT: 150 Division Lot               │
├──────────────────────────┼─────────────────────────────────────────────┤
│ ▶ 150 Division (SP+)     │ Folio: 01-4138-004-0010                     │
│   200 S Biscayne (SP+)   │ Owner of Record: Miami Parking Prop Co LLC  │
│   450 NW 2nd Ave (Reef)  │ Matched Operator: SP+ (Southern Region)     │
│   800 Brickell (Unknown) │                                             │
│                          │ [ Select Existing Contact ]                 │
│ [Filter: Cluster by Corp]│ 👤 Marcus Vance (VP Ops) - SP+ [Attach]     │
│                          │                                             │
│ Shortcuts:               │ Or New:                                     │
│ J/K: Navigate List       │ [Name________] [Email_______] [Phone______] │
│ Enter: Open Detail       │ [Save & Next: Enter]  [Disqualify: Esc]     │
└──────────────────────────┴─────────────────────────────────────────────┘
```

- **Left rail = queue, right = detail.** J/K navigate, Enter opens/saves.
- **Filter by Cluster: Corporate Entity** — resolve all SP+ or Reef lots in one session (batch-attach a contact to 6 lots).
- **Escape hatches:** tabs `Next | Search | Assigned | Recently Worked` — queue is default, not the only mode.

---

## 3. Connections Bar — 32px horizontal ribbon

**Not a 4-line block.** A single-line metadata ribbon pinned below the breadcrumb.

Clean state:
```
🏢 SP+ (14 sites) │ 👤 Marcus Vance (VP Ops) │ 💼 Deal: None │ [Outreach Clear]
```

Lockout state (amber):
```
🛑 COLD OUTREACH RESTRICTED · Active Deal in Stage [PROPOSAL] (Owner: Sarah M.)
```

- 32px tall, always visible, never dominant.
- Clicking "14 sites" opens a slide-over of sister facilities.
- Lockout disables all outbound email/call buttons, replaces with "Add Note / Notify Sarah".

---

## 4. Pipeline — Expandable Portfolio Containers

**Not indivisible cards.** Expandable containers that can drop individual sites.

```
┌─────────────────────────────────────────┐
│ SP+ (Southern Region)                   │
│ $32,000/mo · 14 Lots · 480 Stalls       │
├─────────────────────────────────────────┤
│ Active Sites:                           │
│ • 150 Division (50 stalls)          [✓] │
│ • 200 S Biscayne (120 stalls)       [✓] │
│ • 404 NW 1st Ave (30 stalls)        [✗] │ ◄ Drop site from deal
├─────────────────────────────────────────┤
│ Contact: Marcus Vance · Next: Send Term │
│ ⚠️ Follow-up due today                  │
└─────────────────────────────────────────┘
```

- Dragging the parent card advances the whole portfolio.
- `[✗]` on a child unlinks the lot (reason: owner_refusal) → returns to Properties, without breaking the parent deal.
- Collapsed = "SP+ · 14 lots · 480 stalls"; expanded = child list.

---

## 5. SDR Call — Dialing HUD

**Not a page.** A focused execution bar (Salesloft/Outreach pattern).

```
┌─────────────────────────────────────────────────────────────┐
│ SCRIPT (top 40%):                                           │
│ "Hi Marcus, calling about the 54-stall surface lot at       │
│  150 Division..."                                           │
├─────────────────────────────────────────────────────────────┤
│ DISPOSITION (bottom 60%, number keys):                      │
│ [1] Connected · Interested   → promote to deal              │
│ [2] Left Voicemail           → follow-up in 48h             │
│ [3] Gatekeeper / No Answer   → roll to tomorrow             │
│ [4] Wrong Contact            → clear, back to Research      │
└─────────────────────────────────────────────────────────────┘
```

- Disposition auto-submits, logs duration, loads next call. No modal, no save button. Click = save.

---

## 6. BDR Email — Dynamic Snippet Variables

- Template tokens with fallbacks: `{{stalls_total | "commercial"}} stalls`, `{{company.name | "your parking facility"}}`.
- Unpopulated tokens highlighted red; Copy/Send disabled until filled inline.
- Copy draft → log sent → auto-schedule follow-up (+3 days).

---

## 7. Global patterns (the real 10x)

| Pattern | What |
|---------|------|
| **⌘K command palette** | Search SP+, Marcus Vance, Lot 247, any proposal — from anywhere. Also admin overrides: "Merge Lot", "Reassign to Sarah", "Blacklist Operator". |
| **Micro-snooze** | `H` = 2h, `T` = tomorrow 9am, `M` = next Monday. One key, removes from queue, sets `next_touch_at`. |
| **Auto-advance** | After "Interested" → "Saved · Loading next..." No intermediate screen. |
| **Optimistic updates** | Advance queue in local state instantly (0ms), Firestore write in background, rollback toast on error. |
| **Undo** | Every destructive action: "Archived · Undo (10s)". |
| **Stale detection** | "Sent 5 days ago", "Proposal 11 days old", "No activity 14 days" — surfaced on every queue. |
| **Progress HUD** | `████████░░ 24/50 Reviewed · 42m · 1.8m/lot · [Pause: Space]` docked at bottom. |
| **Clipboard sniffer** | On Hunt, Cmd+V auto-intercepts a SpotHero/Parkopedia URL → background extract → toast "Ingesting 150 Division St...". |
| **Embedded evidence viewer** | 50/50 split: form left, toggleable iframe right (Street View / satellite / listing). No tab-switching. |
| **Momentum metrics** | "Completed Today: 21 · Remaining: 8" on every queue. |
| **Bulk actions** | Admin surfaces: "14 SP+ lots → Assign Sarah / Mark Complete / Export / Archive". |

---

## Surface grades (expert-ranked)

| Surface | Grade | Key change |
|---------|-------|-----------|
| Pipeline Portfolio View | A+ | expandable containers |
| Connections Bar | A+ | 32px ribbon |
| Work Queue | A | dense matrix + confidence |
| SDR Call | A | dialing HUD |
| Research Desk | A- | split-pane |
| BDR Email | B+ | snippet variables |
| Hunt | B | clipboard sniffer (kill manual entry) |

---

## Build order (v2)

| # | Step | Est. |
|---|------|------|
| 1 | Shell layout + routes + ⌘K palette | 2.5h |
| 2 | Connections Bar (ribbon) | 1h |
| 3 | Work Queue dense matrix + confidence + hotlinks | 2.5h |
| 4 | Research Desk split-pane + cluster filter | 2.5h |
| 5 | SDR Call dialing HUD | 1.5h |
| 6 | BDR Email composer + snippets | 1.5h |
| 7 | Pipeline expandable portfolio + drag | 2h |
| 8 | Hunt + clipboard sniffer | 1.5h |
| 9 | Mutations + optimistic updates + undo | 2h |
| 10 | Account layer + operator grouping | 2h |
| 11 | Bridge + score/SLA + snooze | 2h |
| 12 | Site Intelligence + Archived + Team | 3h |

**Total: ~24h.**
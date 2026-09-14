# FORK EDITS — what BCE changed inside the vendored MekBay tree, and why

> **REBASE-1 IN PROGRESS (branch `rebase/mekbay-a882d9f6`, 2026-09-11).** `apps/web` is being re-baselined
> from the original DIRECTIVE-002 fork point `1398d5ea` (2026-03-30) onto **`a882d9f6`** (origin/main,
> 2026-09-09). **Pin reason:** upstream publishes NO release tags for this line (only `v2.1.0-beta`
> `68205733`, 2026-04-05, pre-drift), so per the rule the pin is `origin/main` at a quiet point —
> `a882d9f6` is a `next→main` MERGE (converged), the last 50 commits are small bug-fixes, and the large
> `runtimeconvergence1/2` refactor is NOT on main. Chosen in R0, PM-accepted. The tables below still
> describe the `1398d5ea` fork state; they are rewritten for the new pin in P4 (the "as of" rewrite).

`apps/web` is a **vendored copy** of [MegaMek/mekbay](https://github.com/MegaMek/mekbay) @ `1398d5ea`
(2026-03-30), taken in DIRECTIVE-002. **There is no shared git history** — no remote, no submodule, no
subtree, no merge-base. Updating to a newer upstream is therefore a **manual re-baseline**, not a merge:
take upstream's tree and re-apply our edits on top.

This file exists so that "which lines are ours, and why" is a lookup rather than archaeology at the one
moment it is most expensive. **Most of our edits carry an inline marker** (`SLICE-1`, `DEPLOY-005`,
`HOTFIX-028`, …) — search the file for it. This ledger covers what inline markers cannot: the **JSON and
config files, which have no comment syntax**, plus a map of the whole conflict surface.

**Regenerate the inventory** (never hand-maintain the file list — it will rot):
extract the pinned fork point with `git archive 1398d5ea` from a clone of upstream, then diff it against
`apps/web`. Diff against the **commit**, never a working tree — see the warning at the bottom.

---

## The conflict surface (measured 2026-09-01, against the pinned fork point)

| bucket | count | meaning |
|---|---|---|
| **OURS** | 1,218 files | no upstream counterpart — `campaign/`, `player/`, `auth/`, `shared/`, … |
| **EDITED** | **17 files · 42 hunks · 729 lines** | the only files that can conflict |
| UNTOUCHED | 559 files | take upstream's version wholesale |
| DELETED | 2 | `public/manifest.webmanifest`, `public/.well-known/web-app-origin-association` |
| binary | 5 | favicon, 3 PWA icons, logo — BCE branding (HOTFIX-025) |

Our edits are **666 added / 63 removed — 10.6:1 additive**. We insert into upstream; we rarely rewrite it.

**The real cost driver is not the hunks.** Our own code has **98 import edges into 22 of 301 vendored
modules**, and **74% of those edges land on five modules**: `data.service` (29), `units.model` (17),
`cbt-force-unit.model` (10), `force-serialization` (9), `common.model` (8). A re-baseline breaks our
files through those, and no file-level diff shows it. *Any estimate quoting hunk count without edge count
is quoting the wrong number.*

---

## Files with no comment syntax — the edits recorded here instead

### `angular.json` — 5 hunks
| what | why |
|---|---|
| `"serviceWorker": false` | BCE ships **no** service worker. A stale SW was the session-freshness wedge; it is also actively unregistered at boot (`index.html`, `shared/app-reset.ts`). Re-enabling it reintroduces HOTFIX-028. |
| bundle budget `maximumError: 5.25MB` | raised for the campaign feature set (GM-1 P3 pushed it past 5 MB). The honest fix is lazy-loading; that is a flagged follow-up, and the budget is not to be raised a third time without it. |
| component-style budget `maximumError: 22kB` | HOTFIX-038 — the resolve/settlement modal breached the default on tablet. |
| **`player` build target** (+24) | the port-isolated PLAYER bundle (`src/main.player.ts`). Entirely a BCE concept; upstream has one app. |
| **`player` serve target** (+3) | same, dev-server side. |

### `package.json` — 4 hunks
| what | why |
|---|---|
| `prerun` chain + `gen-slices`, `mirror-catalog`, `gen-meta`, `gen-assets`, `gen-sprites` | the BCE build pipeline. `gen-slices` emits the per-era catalog slices and the SLICE-1 comp-flag side-car; `mirror-catalog` mirrors the upstream JSON so the app never hits db.mekbay.com at runtime. **Nothing in `apps/web` builds correctly without these.** |
| d3 deps (`d3-contour`, `d3-delaunay`, `d3-geo`, …) | the BCE star map. |
| eslint/TS-eslint devDeps | HARDEN-1 stood up `nx lint web` (advisory-with-teeth; baseline 0 errors / 660 warnings). Upstream had no lint target. |
| `typescript` pin | ~~held at the workspace pin (AGENTS.md)~~ — **RETIRED at REBASE-1 (ruling #5 ADOPT TS6):** the pin's `typescript`→`npm:@typescript/typescript6@^6.0.2` alias is taken wholesale, so this is no longer a BCE fork-edit. |

> **REBASE-1 P1 (c) — this fork-edit RE-APPLIED at `a882d9f6` (2026-09-11).** Merged onto the pin's
> `package.json` as ONE marked commit: re-added the 7 `d3-*` deps + their `@types/*` (7) + the eslint/
> angular-eslint/typescript-eslint devDeps (5) + `esbuild`, and re-added the `mirror-catalog` + `gen-slices`
> scripts with `prerun` restored to the full BCE chain (`gen-meta && gen-assets && gen-sprites && mirror-catalog
> && gen-slices`). **NOT re-added:** `@zxing/ngx-scanner` (ruling #6 — rewritten to `@zxing/browser`+`library`,
> already at the pin) and the `typescript` 5.9 pin (ruling #5 — TS6 alias adopted). `socket.io-client` stays
> a ROOT dep (pre-rebase parity — never in `apps/web`; resolves from root `node_modules`). Angular 21→22 and
> every other version bump are the PIN's own, not BCE edits.

### `.gitignore` — 1 hunk
Build-emitted BCE artefacts: `public/mekbay/slim/` (era slices + `comp-flags.json`), the mirrored catalog
JSON, and `dist-player/`. These are generated by `prerun` and must never be committed (REF-001).

---

## The other 15 edited files — all carry inline markers

Search each file for the tag.

| file | tag to search | one-line reason |
|---|---|---|
| `src/app/services/data.service.ts` | `DEPLOY-005`, `HOTFIX-011/012`, `SLICE-1` | era slices (`ensureSlice`), the comp-flag side-car (`hydrateSliceEq`, `compEquipment`), optional-store handling |
| `src/styles.scss` | `HARDEN-4` | scoped-global campaign styles, hoisted out of oversized component sheets |
| `src/index.html` | `HOTFIX-028` | boot fallback + watchdog, SW unregistration, engine-URL guard |
| `src/app/app.routes.ts` | `COMPLIANCE-1` | every BCE route (`/campaign`, `/player`, `/legal`, the cover) |
| `src/app/app.config.ts` | `DEPLOY-002 P4`, `HOTFIX-028` | auth interceptor, app initializers, **service worker removed** |
| `src/main.ts` | `DEPLOY-002 P4`, `REBASE-1 P1` | GM bundle boots the gated shell; the player bundle keeps the plain shell. **REBASE-1 P1 (ruling #8):** a post-bootstrap hook lazy-installs the opt-in computed-BV capture seam (`app/dev/bv-capture.ts`, an OURS file — the witness the goldens' BV blind spot needs). No-op unless `localStorage['bce.test.bvcapture']`. |
| `src/app/models/common.model.ts` | `DEPLOY-004` | `REMOTE_HOST` env-resolved → same-origin `/mekbay` proxy on hosted origins |
| `src/app/services/unit-svg-mek.service.ts` | `TESTER-PLAYTEST-1 #1` | heat-sink pip fallback (`0e23b64`) — **inert once the slice carries sinks; see SLICE-1** |
| `src/app/services/unit-initializer.service.ts` | `SLICE-1` | crit-slot `eq` resolves via `compEquipment` (the registry is empty on a slice-resident session) |
| `src/app/utils/formation-definitions.ts` | `SLICE-1` | weapon-type gate on `cbtHasAutocannon/LRM/SRM` so ammo rows cannot flip them |
| `src/app/models/as-force-unit.model.ts` | `DIRECTIVE-127` | AS Piece-Value falls back to the slim slice's folded `pv` |
| `src/app/services/url-state.service.ts` | `BCE-EDIT: P5` | `applyUrlUpdate` hands `Location.replaceState` the INTERNAL path (`normalize`d) — the externalized `window.location.pathname` got the base href prepended twice under the player bundle's `/player/` base (`/player/player/sheet`, unresumable on reload). Identity under the root base. Added 2026-09-09 (ORDER-2, after the 2026-09-01 measurement above — the EDITED count is now 18). REBASE-1 R0.6 checks whether upstream fixed it. |
| `src/app/components/sidebar/sidebar.component.html` | `HOTFIX-025` | BCE badge |
| `src/app/app.html` | `HOTFIX-025` | BCE lockup |
| `src/app/app.ts` | `DEPLOY-002 P4` | selector moved to `mekbay-app`; `app-root` belongs to the gated shell |
| `src/app/models/cbt-force-unit-state.model.ts` | `REBASE-1 P1` (ORDER-9 H20, ruling #7) | `update()` guards the unguarded `data.crew.map` — a crewless/malformed live state leaves crew untouched instead of throwing inside the loader. NEW P1 fork-edit (upstream did not fix it at the pin). Witness: `battle-force.service.spec.ts` + the E2E broken-sheet proofs. |

---

## Upstream drift as of 2026-09-01 — read this before planning a re-baseline

Measured against `origin/main` @ `7a73eb9a` (2026-09-02):

- **1,686 commits** since the fork point; **263** touch our 17 files; **1,467 files changed** overall.
- **Angular 21 → 22** (major) and **TypeScript 5.9 → 6/7** (`@typescript/native`). Both are pinned in
  `AGENTS.md`; a re-baseline forces both.
- **`@zxing/ngx-scanner` removed** upstream, replaced by `@zxing/browser` + `@zxing/library` — that is the
  QR scanner the player-join flow uses.
- **Renames that break our imports** (mechanical, but they are the 74%):
  - `models/units.model.ts` → **`models/unit-summary.model.ts`**, and the `Unit` interface → **`UnitSummary`**
  - `getEquipments()` / `getEquipmentByName()` moved off `DataService` → **`services/catalogs/equipment-catalog.service.ts`**
    (SLICE-1's `compEquipment()` sits directly on these)
  - `utils/formation-definitions.ts` **deleted**, split into `formation-blueprints` / `formation-predicates` /
    `formation-requirement-engine`
  - `utils/c3-network.util.ts` **deleted**, replaced by an `equipment-handlers/` architecture
- **What survives unchanged, and it is the important part:** `UnitComponent` keeps the identical shape —
  same `E/M/B/A/X/P/O/C/S` type union, same `id`/`p`/`l`/`q`/`q2` (only `cw?` added). `UnitSummary` still
  carries `sheets: string[]`. All four `unit-svg-*` services are present and grown. Every DOM id our
  harnesses assert (`#hsCount`, `#heatProfile`, `.hsPips`, `heatDataPanel`) is still referenced upstream.
  **The record-sheet pipeline and the SLICE-1 comp contract both survive.**

---

## ⚠ Diff against the COMMIT, never a working tree

`C:\projects\mekbay` is the read-only upstream reference. **Its working tree is dirty** — `package.json`
and `app.config.ts` are modified, and `bridge/`, `bridge.service.ts`, `build.log` are **untracked, never in
any commit.** Diffing against it produces phantom findings (it has now done so in two separate sessions —
this is the AGENTS.md `VENDOR-ARCHIVE` gotcha, re-earned). Always materialise the baseline with
`git archive <pinned-sha>` and diff against that.

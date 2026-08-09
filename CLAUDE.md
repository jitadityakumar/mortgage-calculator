# CLAUDE.md

Guidance for coding agents working in this repo.

## What this is

A mortgage calculator for the **England** market (SDLT bands, lender conventions like
the 10% penalty-free overpayment allowance and ERC, are all England-specific — see the
"Research Findings" / "England-Specific Considerations" history in this project's
original working notes if you need the sourcing behind a default).

**FE + Python backend, single-user, local-only.** The frontend is calculation-free — it
calls a FastAPI backend for every calculation, and the backend is the single source of
truth for mortgage math. SQLite persistence lets you save/load named input combinations
(inputs only, never cached results — see "Recompute vs cache" below). No auth: the app
runs locally via Docker on one machine, not hosted or exposed beyond localhost/tailnet.
See `/home/jkumar/claude/local-apps/mortgage-calculator/migration.md` for the full
history of how this got here (it started as a stateless client-side-only app).

Stack: Vite + React 19 + TypeScript (frontend), FastAPI + Pydantic + SQLAlchemy
(backend), Vitest + oxlint (FE tests/lint), pytest (BE tests), Docker Compose.

## Architecture

```
Frontend (React/Vite, src/)          Backend (FastAPI, backend/app/)
- forms, results UI, chart, table    - /api/v1/calculate, /api/v1/compare
- src/api/client.ts calls the API    - /api/v1/saved-calculations (CRUD)
- src/engine/sdlt.ts only            - engine/ (mortgage math, ported from
  (SDLT stays client-side)             the original TS engine, 1:1)
                                      - db/ (SQLAlchemy models, SQLite)
```

- **`backend/app/engine/`** — pure Python, zero I/O, the single source of truth for
  mortgage math. Given a `MortgageInputs` (Pydantic model), returns a full
  month-by-month `MortgageResult`. Every module has a co-located test in
  `backend/tests/engine/`.
  - `mortgage.py` — the core simulation loop (`calculate_mortgage`,
    `compare_with_and_without_overpayments`). This is where almost all the real
    complexity lives: fixed→variable rate recasting, both overpayment modes, lump
    sums, allowance/ERC modeling, remortgage rate-cycling, savings-pool payouts, and
    final-payment rounding.
  - `types.py` — all shared Pydantic models. Read the doc comments on the TS mirror
    (`src/api/types.ts`) for *why* each mode enum exists and how modes interact —
    that context lives in the hand-written comments, not the code alone.
  - `config.py` — the runtime source of truth for every default value
    (`MortgageConfig` fields like overpayment allowance %/ERC rate/arrangement fee,
    plus rate/term/deposit/overpayment-mode defaults) is the `defaults_config` DB row
    (single row, admin-editable), read per-request via `load_current_defaults(db)` — no
    in-process caching (see the docstring for why: test-DB isolation and threadpool
    races). `defaults.json` is now only the **seed/reset target**:
    `load_seed_defaults()` reads it to seed a fresh DB at startup
    (`backend/app/main.py`) and to restore via `POST /api/v1/defaults/reset`. Estimates,
    not real lender terms — keep them clearly labeled as such in UI copy. Served to the
    frontend via `GET /api/v1/defaults`, editable via `PUT /api/v1/defaults` (validated
    by `validate_defaults()`) — the admin UI at `/admin` (`src/components/AdminPage.tsx`)
    is the only place that calls the write endpoints, so the FE never hand-duplicates a
    second copy (see `src/api/` below).
  - `money.py` — integer-pence arithmetic, via `js_round()` (replicates JS's
    `Math.round` exactly — NOT Python's banker's-rounding `round()`, which would
    silently diverge). **Never use raw floats for money math** in this codebase; all
    amounts convert to pence at the boundary and back to pounds only for display.
  - `validate.py` — input validation (deposit ≥ property value, 0% rate special case,
    fixed term > total term, etc.).
  - `sdlt.py` — Stamp Duty Land Tax. Also exists client-side at `src/engine/sdlt.ts`
    (see below) — deliberately duplicated, not delegated to the backend.
- **`backend/app/api/`** — `calculate.py` (stateless `/calculate`, `/compare`),
  `saved.py` (persistence CRUD). `backend/app/db/` — SQLAlchemy models/session. No
  Alembic yet (see migration.md's Phase 4 update — the next schema change needs one).
- **`src/engine/sdlt.ts`** — the ONE piece of calculation logic still client-side.
  Self-contained, stateless, no backend endpoint exists for it — it was judged not to
  be part of the "two engines can drift" risk the migration addressed (a static tax
  band lookup, not stateful simulation). Don't add other calculation logic here; this
  is a deliberate, narrow exception, not a precedent.
- **`src/api/`** — `client.ts` (fetch wrapper for every backend endpoint, including
  `fetchDefaults()`/`updateDefaults()`/`resetDefaults()`), `types.ts` (hand-mirrors
  `backend/app/engine/types.py` field-for-field — kept in sync by hand; see
  migration.md "Open follow-ups" for auto-generating this later, and includes
  `MortgageDefaults`, the wire type for `GET`/`PUT /api/v1/defaults`). Form pre-fill no
  longer hardcodes a second copy of the backend's defaults — `App.tsx` fetches
  `GET /api/v1/defaults` on mount (backed by the `defaults_config` DB row, seeded
  from/resettable to `backend/app/engine/defaults.json`) and builds the initial form
  via `buildDefaultFormState()` (`src/types/formState.ts`).
- **`src/components/AdminPage.tsx`** — the `/admin` page (routed by a manual
  `window.location.pathname` check in `src/main.tsx`, no router dependency), lets a
  local user view/edit every field in `MortgageDefaults` via `PUT /api/v1/defaults`,
  plus a "Reset to shipped defaults" action. No auth (matches this app's single-user,
  local-only design).
  - `deposit`, `depositSavings`, `isFirstTimeBuyer`, and `deriveDepositFromSavings` feed
    only `buildDefaultFormState()`'s initial pre-fill and (for `deposit`) the
    server-side fallback for partial `/calculate` requests / saved-calculation
    resolution — never any engine calculation (SDLT and the deposit auto-fill formula
    are computed client-side). `deriveDepositFromSavings` also gates App.tsx's *live*
    auto-fill (`updateDepositDriver`): when true (the shipped default), `deposit`
    recomputes from `depositSavings − SDLT(...)` on every property value/savings/FTB
    change, same as before this field existed; when false, `deposit` is a plain
    user-controlled field that never auto-recomputes, and the flat `deposit` default is
    what both the initial pre-fill and the server-side fallback use instead.
- **`src/`** (UI) — `App.tsx` wires a form column to a results column, `async`: it
  debounces (300ms) and calls the backend on every input change, with loading and
  error states. Form state (`src/types/formState.ts`) is all strings, so
  partial/blank input while typing doesn't need special-casing; `mapFormState.ts`
  parses it into `MortgageInputs` (`mapFormStateToInputs`) and back
  (`mapInputsToFormState`, used when loading a saved calculation — round-trip fidelity
  matters here, see `src/mapFormState.test.ts`). `App.tsx` derives UI booleans (e.g.
  `hasOverpayments`, in `src/hasOverpayments.ts`) from the same inputs that produced
  the *currently displayed* result — not live form state — to avoid a stale-render
  window where an old result briefly pairs with a flag computed from newer,
  not-yet-calculated inputs. Don't reintroduce a second source of truth here; it's
  caused real bugs before (both in the old client-engine days and during this
  migration itself).

## Key design decisions worth knowing before you change behavior

- **Month-by-month simulation, not just the closed-form annuity formula.** The
  closed-form formula only works for a static rate/no overpayments; overpayments, lump
  sums, and the fixed→variable transition all break its assumptions, so the loop
  recomputes per month.
- **"Reduce term" vs "reduce payment"**: reduceTerm keeps the payment fixed and pays
  off early; reducePayment recasts the payment against the *remaining original term*
  every time an overpayment lands, so it visibly declines over time. reducePayment
  mode *cannot* hold the term exactly fixed — any recurring overpayment mathematically
  must finish somewhat early. This is intentional; don't try to "fix" it to land
  exactly on the original term.
- **Every optional `MortgageInputs` field's fallback is a real, admin-editable
  `MortgageDefaults` field** (`backend/app/engine/defaults.json`, admin-editable via
  `PUT /api/v1/defaults`) — including `bankedSavingsDestination` (shipped default
  `'lumpSumEachCycle'`) and `rateAfterFixedTermMode` (shipped default
  `'remortgageToNewFixed'`). There's no separate "conservative engine fallback vs
  opinionated FE literal" split anymore; both the FE's initial pre-fill
  (`buildDefaultFormState` in `types/formState.ts`) and the backend's
  `resolve_mortgage_inputs()` read the same shared default. If you add a new optional
  `MortgageInputs` field, follow this pattern: add it to `MortgageDefaults`
  (`types.py`/`types.ts`/`defaults.json`), wire it into `resolve_mortgage_inputs()`,
  and read it from `defaults` in `buildDefaultFormState()` — and if you add it to
  `mapInputsToFormState`'s fallback, use the real engine default, not `0`, unless `0`
  is genuinely the no-op value for that field.
- **Rate-after-fixed-term and savings-destination are independent toggles.** Don't
  couple them back together — that was tried, caused a real regression (periodic
  lump-sum payouts silently stopped firing under `stayOnVariable`), and was
  deliberately un-coupled. Payout *timing* differs by mode: `remortgageToNewFixed`
  pays out the month immediately after every fixed-deal boundary;
  `stayOnVariable` pays out periodically every `savingsPayoutIntervalMonths` (a
  whole number of months), first payout when the initial fixed term ends.
- **Money conservation is a real invariant, tested explicitly**: pool money freed up
  each month must always equal `totalOverpaid + unallocatedSavingsPot` — nothing
  should vanish, including at loop-exit edge cases like an overshoot on the payoff
  month. If you touch the overpayment/payout logic, check there's still a conservation
  test covering your change.
- **All money math happens in integer pence**, on both sides — `poundsToPence`/
  `penceToPounds` in `backend/app/engine/money.py`, using `js_round()` not Python's
  `round()`. Never carry pounds as floats through the simulation loop.
- **Recompute vs cache for saved calculations**: `SavedCalculation` rows store only
  the `MortgageInputs`, never the computed result. Loading a saved calculation
  recomputes via `/api/v1/compare` rather than replaying a cached result — so a saved
  calculation from before a `DEFAULT_CONFIG` tweak never silently shows stale numbers
  next to freshly-computed ones. Don't add a `result` column to cache this; that was a
  deliberate decision, not an oversight (see migration.md "Recompute vs cache").
- **Object-spread over a Pydantic-serialized `Partial<T>` is a bug, not a merge.**
  Pydantic serializes every field of a partial config as explicit `null` for anything
  unset (not omitted) — `{ ...DEFAULT_CONFIG, ...maybeNullConfig }` silently clobbers
  real defaults with `null`. Filter nullish values before merging (see
  `mapInputsToFormState` in `src/mapFormState.ts` for the pattern). This bit the
  Phase 4 persistence work once already.

## Workflow conventions

- **Frontend**: run `npm test` (Vitest) before considering any change done. Run
  `npm run build` (typecheck + production build) and `npm run lint` (oxlint) too.
- **Backend**: run `cd backend && .venv/bin/python -m pytest tests/ -q` before
  considering any engine/API change done. Set up the venv first if it doesn't exist:
  `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- For any change to `backend/app/engine/`, prefer adding a regression test that would
  fail without the fix, not just fixing the symptom — and mirror the change in
  `src/api/types.ts` if it touches the wire format. `backend/app/engine/defaults.json`
  is the *shipped* default for each value (seed/reset target only, since the admin page
  went in) — a running app's actual defaults live in the `defaults_config` DB row and
  are edited via `/admin`, not by hand-editing the JSON file.
- This project has previously used a **dual-review pass** for correctness-critical
  engine changes: one pass focused on code quality/consistency, a second independent
  pass focused purely on re-deriving the math by hand and checking it against the
  implementation. If you're asked to do a similar review, keep the two concerns
  separate rather than blending them into one pass.
- Test the full stack in Docker (`docker compose up --build`), not just `npm run dev`
  + a bare `uvicorn`, before considering a cross-cutting change (anything touching the
  API contract, CORS, the nginx proxy, or persistence) done — `vite dev`'s proxy and
  nginx's production proxy are configured separately and can drift.

## Commands

```bash
# Primary way to run the whole app (frontend + backend + persistence):
docker compose up --build          # http://localhost:8090 (frontend), :8000 (API/docs at /docs)

# Frontend only (backend must be reachable separately, e.g. a local uvicorn or the
# Docker backend service, for anything beyond static UI iteration):
npm install
npm run dev          # dev server, proxies /api -> http://localhost:8000
npm test              # Vitest, run once
npm run test:watch
npm run build          # tsc -b && vite build
npm run lint            # oxlint

# Backend only:
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload   # http://localhost:8000
.venv/bin/python -m pytest tests/ -q

# Deploy to the machine this app runs on long-term, from any other machine on the
# tailnet:
cp .env.deploy.example .env.deploy   # fill in REMOTE_HOST etc., once
./deploy.sh
```

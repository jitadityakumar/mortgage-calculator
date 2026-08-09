# Mortgage Calculator

A mortgage calculator for the England market. Model your monthly payments, overpayments,
remortgage cycles, and Stamp Duty Land Tax (SDLT) — save named scenarios and reload them
later.

**Not financial advice.** Figures are estimates based on the standard amortization formula
and configurable assumptions — always verify against your actual mortgage offer.

**Single-user, local-only.** Runs on one machine via Docker, no accounts, no auth, not
exposed beyond localhost/your tailnet.

## Features

- Standard fixed → variable (follow-on) rate amortization, given property value, deposit,
  fixed rate/term, variable rate, and total term.
- Overpayments: recurring monthly (fixed amount, or "auto" — the most that fits within a
  target % of your lender's penalty-free allowance), one-off lump sums at specific months,
  and either "reduce term" or "reduce payment" mode.
- Models a rent + savings pool: money freed up by not renting, plus existing savings, minus
  a recurring service charge/ground rent, can fund overpayments automatically.
- Once-the-fixed-deal-ends modeling, three modes: repeatedly remortgage onto a new
  fixed-rate deal (with a penalty-free gap on the variable rate in between), stay on the
  variable rate for good, or a hybrid that cycles fixed deals until a lookahead shows
  staying on variable from the next boundary would clear the loan within one more fixed
  deal's duration — then commits to variable permanently. Banked-savings payout timing
  matches whichever mode is active.
- Configurable lender assumptions: penalty-free overpayment allowance %, Early Repayment
  Charge (ERC) rate, arrangement fee (upfront or added to the loan).
- Full month-by-month amortization schedule and a balance-over-time chart, comparing with
  vs. without overpayments.
- SDLT (Stamp Duty) calculator, including first-time-buyer relief.
- **Save and reload named calculations** — inputs only (not cached results), so a reload
  always reflects the current lender-assumption defaults rather than showing stale numbers.
- **Admin page** (`/admin`) — view and edit every shared default (rates, term, overpayment
  behavior, allowance/ERC assumptions, etc.) that the calculator pre-fills from, with a
  one-click reset back to the shipped defaults.

## Getting started

Requires Docker.

```bash
docker compose up --build
```

- App: http://localhost:8090
- Admin page (shared defaults): http://localhost:8090/admin
- API + interactive docs: http://localhost:8000/docs

Saved calculations persist in a named Docker volume across restarts and rebuilds.

### Frontend-only iteration

For UI-only work where you don't need real backend calculations, you can run just the
Vite dev server (requires Node.js — see `package.json` for versions). It proxies `/api`
to `http://localhost:8000`, so a backend still needs to be reachable there for anything
beyond static UI changes — e.g. `cd backend && .venv/bin/uvicorn app.main:app --reload`,
or point it at the Docker backend service.

```bash
npm install
npm run dev           # dev server, http://localhost:5173
# or: ./start.sh / ./stop.sh to run it detached
```

```bash
npm run build          # type-check + production build
npm run test            # run the frontend test suite once
npm run test:watch      # run tests in watch mode
npm run lint             # oxlint
```

### Backend-only

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload   # http://localhost:8000
.venv/bin/python -m pytest tests/ -q
```

### Deploying to another machine

`deploy.sh` builds both Docker images locally and ships them to a remote host over SSH
(e.g. from a dev machine to the machine this app runs on long-term over Tailscale):

```bash
cp .env.deploy.example .env.deploy   # fill in REMOTE_HOST etc., once
./deploy.sh
```

## How it works

- **Backend** (`backend/app/`) — FastAPI. `engine/` is the single source of truth for
  mortgage math (pure Python, integer-pence arithmetic, no I/O), exposed via
  `POST /api/v1/calculate` and `POST /api/v1/compare`. `db/` + `api/saved.py` handle
  persistence: `SavedCalculation` rows store inputs only, never a cached result — loading
  one recomputes it, so it can't go silently stale after a config tweak. Fully covered by
  pytest (`backend/tests/`).
- **Frontend** (`src/`) — a single-page React app (`App.tsx`) with a form on the left and
  results (summary, chart, amortization table) on the right. Calculation-free: it debounces
  input changes and calls the backend for every result. Form state is all strings (so
  inputs can be blank/partial while typing) and gets mapped to/from the backend's
  `MortgageInputs` shape via `mapFormState.ts`. The one exception is
  `src/engine/sdlt.ts` (Stamp Duty) — a small, stateless, self-contained calculation kept
  client-side since there's no backend endpoint for it.

See `CLAUDE.md` for a more detailed architecture map aimed at coding agents working in this
repo, and `migration.md`'s history (in this project's working notes) for how the app got
here — it started as a stateless, client-side-only calculator.

## License

GPL-3.0 — see `LICENSE`.

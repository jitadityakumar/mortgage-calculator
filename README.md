# Mortgage Calculator

A stateless mortgage calculator for the England market. Model your monthly payments,
overpayments, remortgage cycles, and Stamp Duty Land Tax (SDLT) — all in the browser, with
nothing saved between sessions.

**Not financial advice.** Figures are estimates based on the standard amortization formula
and configurable assumptions — always verify against your actual mortgage offer.

## Features

- Standard fixed → variable (follow-on) rate amortization, given property value, deposit,
  fixed rate/term, variable rate, and total term.
- Overpayments: recurring monthly (fixed amount, or "auto" — the most that fits within a
  target % of your lender's penalty-free allowance), one-off lump sums at specific months,
  and either "reduce term" or "reduce payment" mode.
- Models a rent + savings pool: money freed up by not renting, plus existing savings, minus
  a recurring service charge/ground rent, can fund overpayments automatically.
- Remortgage cycling: simulate repeatedly rolling onto a new fixed-rate deal (with a gap on
  the variable rate in between) versus staying on the variable rate for good, each with
  matching timing for when banked savings pay out as lump sums.
- Configurable lender assumptions: penalty-free overpayment allowance %, Early Repayment
  Charge (ERC) rate, arrangement fee (upfront or added to the loan).
- Full month-by-month amortization schedule and a balance-over-time chart, comparing with
  vs. without overpayments.
- SDLT (Stamp Duty) calculator, including first-time-buyer relief.

## Getting started

Requires Node.js (see `package.json` for dependency versions).

```bash
npm install
./start.sh          # starts the dev server in the background on http://localhost:5173
./stop.sh            # stops it
```

Or run it in the foreground with the usual Vite scripts:

```bash
npm run dev          # dev server, foreground
npm run build         # type-check + production build
npm run test          # run the test suite once
npm run test:watch    # run tests in watch mode
npm run lint          # oxlint
```

## How it works

The calculator has two layers:

- **Engine** (`src/engine/`) — pure TypeScript, no UI dependencies. Takes a `MortgageInputs`
  object and returns a full monthly schedule plus summary totals. All money math is done in
  integer pence to avoid floating-point rounding errors. Fully covered by unit tests
  (`*.test.ts` alongside each module).
- **UI** (`src/`) — a single-page React app (`App.tsx`) with a form on the left and results
  (summary, chart, amortization table) on the right. Form state is all strings (so inputs
  can be blank/partial while typing) and gets parsed/mapped to `MortgageInputs` via
  `mapFormState.ts`.

See `CLAUDE.md` for a more detailed architecture map aimed at coding agents working in this
repo.

## License

GPL-3.0 — see `LICENSE`.

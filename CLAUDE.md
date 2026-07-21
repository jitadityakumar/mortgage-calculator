# CLAUDE.md

Guidance for coding agents working in this repo.

## What this is

A stateless, client-side mortgage calculator for the **England** market (SDLT bands,
lender conventions like the 10% penalty-free overpayment allowance and ERC, are all
England-specific — see the "Research Findings" / "England-Specific Considerations"
history in this project's original working notes if you need the sourcing behind a
default). No backend, no persistence — nothing is saved between sessions, by design.

Stack: Vite + React 19 + TypeScript, Vitest for tests, oxlint for linting.

## Architecture

Two layers, kept strictly separate:

- **`src/engine/`** — pure TypeScript, zero UI dependencies, zero I/O. Given a
  `MortgageInputs` object, returns a full month-by-month `MortgageResult`. Every module
  has a co-located `*.test.ts`.
  - `mortgage.ts` — the core simulation loop (`calculateMortgage`,
    `compareWithAndWithoutOverpayments`). This is where almost all the real complexity
    lives: fixed→variable rate recasting, both overpayment modes, lump sums,
    allowance/ERC modeling, remortgage rate-cycling, savings-pool payouts, and
    final-payment rounding.
  - `types.ts` — all shared types. Read the doc comments on `MortgageInputs` and its
    mode enums (`OverpaymentMode`, `MonthlyOverpaymentAmountMode`,
    `BankedSavingsDestination`, `RateAfterFixedTermMode`) before changing engine
    behavior — they document *why* each mode exists and how the modes interact, which
    isn't obvious from the code alone.
  - `config.ts` — illustrative defaults (`DEFAULT_CONFIG`) for lender mechanics that
    vary in the real world (overpayment allowance %, ERC rate, arrangement fee, etc.).
    These are estimates, not real lender terms — always keep them clearly labeled as
    such in any UI copy.
  - `money.ts` — integer-pence arithmetic. **Never use raw floats for money math** in
    this codebase; all amounts are converted to pence at the boundary and back to
    pounds only for display.
  - `validate.ts` — input validation (deposit ≥ property value, 0% rate special case,
    fixed term > total term, etc.).
  - `sdlt.ts` — Stamp Duty Land Tax, a fully independent side-calculation (one-off
    purchase cost, not part of the amortization engine).
- **`src/`** (UI) — `App.tsx` wires a form column to a results column. Form state
  (`src/types/formState.ts`) is all strings, so partial/blank input while typing
  doesn't need special-casing; `mapFormState.ts` parses it into a `MortgageInputs` and
  is the single place that happens. `App.tsx` derives all UI booleans (e.g.
  `hasOverpayments`) from the same parsed `inputs` object passed to the engine, never
  by re-inspecting raw form strings — keeping the UI's idea of "what's active" always
  in sync with what the engine actually computed. Don't reintroduce a second source of
  truth here; it's caused real bugs before.

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
- **Engine-level defaults are conservative; the app's own form defaults are more
  opinionated.** e.g. the engine defaults `bankedSavingsDestination` to
  `'keepAsSavings'` and `rateAfterFixedTermMode` to `'stayOnVariable'` when a field is
  omitted, but `DEFAULT_FORM_STATE` in `types/formState.ts` explicitly opts into
  `'lumpSumEachCycle'` / `'remortgageToNewFixed'` since it also seeds nonzero
  rent/savings. If you add a new optional `MortgageInputs` field, follow this pattern:
  safe default in the engine, more opinionated default in the form state.
- **Rate-after-fixed-term and savings-destination are independent toggles.** Don't
  couple them back together — that was tried, caused a real regression (periodic
  lump-sum payouts silently stopped firing under `stayOnVariable`), and was
  deliberately un-coupled. Payout *timing* differs by mode: `remortgageToNewFixed`
  pays out the month immediately after every fixed-deal boundary;
  `stayOnVariable` pays out periodically every `savingsPayoutIntervalYears` (accepts
  fractional years), first payout when the initial fixed term ends.
- **Money conservation is a real invariant, tested explicitly**: pool money freed up
  each month must always equal `totalOverpaid + unallocatedSavingsPot` — nothing
  should vanish, including at loop-exit edge cases like an overshoot on the payoff
  month. If you touch the overpayment/payout logic, check there's still a conservation
  test covering your change.
- **All money math happens in integer pence.** Convert at the boundary
  (`poundsToPence`/`penceToPounds` in `money.ts`), never carry pounds as floats through
  the simulation loop.

## Workflow conventions

- Run `npm test` (Vitest) before considering any engine change done — the test suite
  is the primary correctness guardrail for this project (currently 76+ tests: engine
  math, allowance/ERC boundaries, validation edge cases, rounding robustness, UI
  interaction paths).
- Run `npm run build` (typecheck + production build) and `npm run lint` (oxlint) too.
- For any change to `src/engine/`, prefer adding a regression test that would fail
  without the fix, not just fixing the symptom.
- This project has previously used a **dual-review pass** for correctness-critical
  engine changes: one pass focused on code quality/consistency, a second independent
  pass focused purely on re-deriving the math by hand and checking it against the
  implementation. If you're asked to do a similar review, keep the two concerns
  separate rather than blending them into one pass.

## Commands

```bash
npm install
npm run dev        # dev server (or ./start.sh / ./stop.sh to run it detached)
npm test           # Vitest, run once
npm run test:watch
npm run build       # tsc -b && vite build
npm run lint        # oxlint
```

from __future__ import annotations

from typing import Optional

from .config import load_seed_defaults, resolve_config, resolve_mortgage_inputs
from .money import js_round, pence_to_pounds, pounds_to_pence
from .types import (
    ComparisonResult,
    MonthlyScheduleEntry,
    MortgageConfig,
    MortgageDefaults,
    MortgageInputs,
    MortgageResult,
    MortgageValidationError,
)
from .validate import validate_inputs


def _pct_to_monthly_rate(annual_pct: float) -> float:
    return annual_pct / 100 / 12


def _calc_monthly_payment_pence(balance_pence: int, monthly_rate: float, remaining_months: int) -> int:
    """Standard annuity formula, in integer pence. Handles the 0%-rate special case."""
    if remaining_months <= 0:
        return balance_pence
    if monthly_rate == 0:
        return js_round(balance_pence / remaining_months)
    factor = (1 + monthly_rate) ** remaining_months
    payment = (balance_pence * (monthly_rate * factor)) / (factor - 1)
    return js_round(payment)


def _compute_allowance_limit_pence(balance_pence: int, original_principal_pence: int, config: MortgageConfig) -> int:
    basis_balance = original_principal_pence if config.allowanceBasis == "original" else balance_pence
    return js_round((basis_balance * config.annualOverpaymentAllowancePct) / 100)


def _would_clear_within_window_on_variable(
    *,
    balance_pence: int,
    principal_pence: int,
    savings_pot_pence: int,
    start_month: int,
    remaining_total_term_months: int,
    window_months: int,
    variable_monthly_rate: float,
    config: MortgageConfig,
    overpayment_mode: str,
    overpayment_amount_mode: str,
    fixed_monthly_overpayment_pence: int,
    target_utilization_pct: float,
    monthly_budget_pool_pence: int,
    banked_destination: str,
    savings_payout_interval_months: int,
    allowance_limit_this_year: int,
    allowance_used_this_year: int,
    auto_target_used_this_year: int,
) -> bool:
    """'hybrid' mode's boundary check: if the loan switched to the variable
    rate right now and stayed there, would it clear within `window_months`
    (the fixed deal's own duration)? Mirrors calculate_mortgage()'s per-month
    math for a permanently-variable regime — single payment recast at the
    boundary, periodic savings payout counted from the boundary, same
    allowance/ERC rules — kept as a separate function rather than sharing
    calculate_mortgage()'s loop directly, since this only ever needs a
    pass/fail projection, never a real schedule.

    The three allowance_* arguments carry in the real mid-year state as of
    the boundary month (the caller's own live values) rather than starting
    fresh — the window begins mid-year from the loan's actual allowance-year
    alignment, and treating it as a fresh reset would bias the projection
    (optimistically understating what's already been used, pessimistically
    if the limit itself has since drifted with the balance) in a direction
    that depends on the specific inputs, not a single safe-to-ignore one.
    The loop's own (month - 1) % 12 == 0 reset still fires normally for any
    later anniversary that falls inside the window.

    Known simplification: ignores dated lump-sum overpayments that would
    fall inside the lookahead window (calculate_mortgage()'s real run still
    applies them if hybrid ends up continuing to cycle instead) — an
    acceptable approximation given lump sums are an optional, occasional
    input, and the window is short relative to the loan's life.
    """
    months_to_check = min(window_months, remaining_total_term_months)
    if months_to_check <= 0:
        return balance_pence <= 0

    balance = balance_pence
    savings_pot = savings_pot_pence
    payment = _calc_monthly_payment_pence(balance, variable_monthly_rate, remaining_total_term_months)
    # ERC never applies here (config.ercAppliesDuringFixedTermOnly True is
    # the common case, and this window is always variable-rate throughout),
    # unless the config deliberately applies ERC outside the fixed term too.
    allowance_applies = not config.ercAppliesDuringFixedTermOnly

    for i in range(months_to_check):
        month = start_month + i
        if (month - 1) % 12 == 0:
            allowance_limit_this_year = _compute_allowance_limit_pence(balance, principal_pence, config)
            allowance_used_this_year = 0
            auto_target_used_this_year = 0

        opening_balance = balance
        interest = js_round(balance * variable_monthly_rate)
        is_final_real_month = i == remaining_total_term_months - 1
        pay = opening_balance + interest if is_final_real_month else min(payment, opening_balance + interest)
        principal_portion = pay - interest
        balance -= principal_portion

        effective_savings = max(0, monthly_budget_pool_pence - pay)

        # Mirrors the main loop's auto_pacing_active: once ERC-free
        # (allowance_applies False) and the pot pays out as a lump sum
        # anyway, the monthly 'auto' drip stops pacing itself — the payout
        # already sweeps the banked pot, so a parallel drip would only
        # relabel money one month early.
        auto_pacing_active = allowance_applies or banked_destination != "lumpSumEachCycle"

        recurring_overpayment = 0
        if overpayment_amount_mode == "fixed":
            recurring_overpayment = fixed_monthly_overpayment_pence
        elif overpayment_amount_mode == "auto" and auto_pacing_active:
            target_allowance_limit_this_year = js_round((allowance_limit_this_year * target_utilization_pct) / 100)
            months_remaining_in_year = 12 - ((month - 1) % 12)
            remaining_target = max(0, target_allowance_limit_this_year - auto_target_used_this_year)
            equal_monthly_installment = js_round(remaining_target / months_remaining_in_year)
            recurring_overpayment = min(effective_savings, equal_monthly_installment)

        savings_added = max(0, effective_savings - recurring_overpayment)
        savings_pot += savings_added

        # Immediate payout at the window's first month (i == 0), then every
        # `savings_payout_interval_months` after that — mirrors
        # stayOnVariable's real formula, where the first payout lands the
        # month the fixed term ends rather than a full interval later.
        is_payout_month = banked_destination == "lumpSumEachCycle" and i % savings_payout_interval_months == 0
        payout_applied = 0
        if is_payout_month and savings_pot > 0:
            remaining_real_allowance = max(0, allowance_limit_this_year - allowance_used_this_year - recurring_overpayment)
            payout_applied = min(savings_pot, remaining_real_allowance) if allowance_applies else savings_pot
            savings_pot -= payout_applied

        overpayment_wanted = recurring_overpayment + payout_applied
        overpayment_applied = min(overpayment_wanted, balance)

        if overpayment_applied > 0 and allowance_applies:
            remaining_allowance = max(0, allowance_limit_this_year - allowance_used_this_year)
            within_allowance = min(overpayment_applied, remaining_allowance)
            allowance_used_this_year += within_allowance
        auto_target_used_this_year += overpayment_applied

        balance -= overpayment_applied
        if balance < 0:
            balance = 0

        if overpayment_mode == "reducePayment" and overpayment_applied > 0 and balance > 0:
            remaining_months = remaining_total_term_months - (i + 1)
            if remaining_months > 0:
                payment = _calc_monthly_payment_pence(balance, variable_monthly_rate, remaining_months)

        if balance <= 0:
            return True

    return False


def calculate_mortgage(inputs: MortgageInputs, defaults: Optional[MortgageDefaults] = None) -> MortgageResult:
    # `defaults` is optional so the engine stays independently callable/
    # testable without a DB session (falls back to the shipped
    # defaults.json); API call sites always pass the live DB defaults
    # explicitly (app.api.calculate).
    d = defaults or load_seed_defaults()
    inputs = resolve_mortgage_inputs(inputs, d)
    issues = validate_inputs(inputs)
    if issues:
        raise MortgageValidationError(issues)

    config = resolve_config(inputs.config, d)
    mode = inputs.overpaymentMode
    warnings: list[str] = []

    fee_pence = pounds_to_pence(config.arrangementFee)
    base_principal_pence = pounds_to_pence(inputs.propertyValue - inputs.deposit)
    principal_pence = base_principal_pence + (fee_pence if config.arrangementFeeAddedToLoan else 0)

    fixed_monthly_rate = _pct_to_monthly_rate(inputs.fixedRateAnnualPct)
    total_term_months = inputs.totalTermMonths
    fixed_term_months = inputs.fixedTermMonths

    initial_monthly_payment_pence = _calc_monthly_payment_pence(
        principal_pence, fixed_monthly_rate, total_term_months
    )

    overpayment_amount_mode = inputs.monthlyOverpaymentAmountMode
    banked_destination = inputs.bankedSavingsDestination
    savings_payout_interval_months = max(
        1,
        js_round(
            inputs.savingsPayoutIntervalMonths
            if inputs.savingsPayoutIntervalMonths is not None
            else d.savingsPayoutIntervalMonths
        ),
    )
    fixed_monthly_overpayment_pence = pounds_to_pence(inputs.fixedMonthlyOverpayment)
    target_utilization_pct = inputs.targetAllowanceUtilizationPct
    monthly_budget_pool_pence = max(
        0,
        pounds_to_pence(inputs.currentRent + inputs.monthlySavings - inputs.serviceCharge),
    )

    rate_after_fixed_term_mode = inputs.rateAfterFixedTermMode
    # 'hybrid' cycles through fixed deals exactly like remortgageToNewFixed
    # until a boundary check (see below) decides to commit to the variable
    # rate permanently instead — so it shares remortgageToNewFixed's cycling
    # arithmetic pre-commit.
    hybrid_active = rate_after_fixed_term_mode == "hybrid"
    cycling_active = (
        rate_after_fixed_term_mode in ("remortgageToNewFixed", "hybrid")
        and fixed_term_months > 0
        and fixed_term_months < total_term_months
    )
    gap_months = max(0, js_round(inputs.remortgageGapMonths if inputs.remortgageGapMonths is not None else d.remortgageGapMonths))
    cycle_length = fixed_term_months + gap_months
    variable_monthly_rate = _pct_to_monthly_rate(inputs.variableRateAnnualPct)
    # Set once hybrid's boundary check decides switching to variable would
    # clear the loan within a fixed deal's own duration — every month after
    # this one is forced permanently variable, never re-fixing again.
    hybrid_committed_at_month: Optional[int] = None

    savings_pot_pence = 0
    previous_month_was_fixed_period_boundary = False

    lump_sums_by_month: dict[int, int] = {}
    for lump in inputs.lumpSums or []:
        lump_sums_by_month[lump.atMonth] = lump_sums_by_month.get(lump.atMonth, 0) + pounds_to_pence(lump.amount)

    balance = principal_pence
    current_payment = initial_monthly_payment_pence
    variable_period_monthly_payment_pence = 0
    captured_variable_period_payment = False

    allowance_limit_this_year = _compute_allowance_limit_pence(balance, principal_pence, config)
    allowance_used_this_year = 0
    auto_target_used_this_year = 0

    schedule: list[MonthlyScheduleEntry] = []
    month = 1
    payoff_month = total_term_months

    total_interest_pence = 0
    total_principal_pence = 0
    total_overpaid_pence = 0
    total_erc_pence = 0

    while month <= total_term_months:
        hybrid_committed = hybrid_active and hybrid_committed_at_month is not None and month > hybrid_committed_at_month

        position_in_cycle = (month - 1) % cycle_length if cycling_active else month - 1
        in_fixed_tie_in = (
            False
            if hybrid_committed
            else (position_in_cycle < fixed_term_months if cycling_active else month <= fixed_term_months)
        )
        is_variable_period = not in_fixed_tie_in
        monthly_rate = _pct_to_monthly_rate(inputs.variableRateAnnualPct) if is_variable_period else fixed_monthly_rate
        rate_pct_now = inputs.variableRateAnnualPct if is_variable_period else inputs.fixedRateAnnualPct

        is_regime_start = (
            (month > 1 and (position_in_cycle == 0 or position_in_cycle == fixed_term_months))
            if cycling_active
            else (is_variable_period and month == fixed_term_months + 1)
        )
        if hybrid_committed and month > hybrid_committed_at_month + 1:
            # The single recast onto the variable rate happens at month ==
            # hybrid_committed_at_month + 1 (whichever raw trigger it lines
            # up with — normally position_in_cycle == fixed_term_months, or
            # == 0 in the zero-gap edge case where they coincide) and is left
            # alone above. Every month after that must not let cycle_length's
            # modulo wrap back around into a spurious extra recast — nothing
            # about the rate changes again once committed.
            is_regime_start = False
        if is_regime_start:
            remaining_months = total_term_months - month + 1
            current_payment = _calc_monthly_payment_pence(balance, monthly_rate, remaining_months)
            if is_variable_period and not captured_variable_period_payment:
                variable_period_monthly_payment_pence = current_payment
                captured_variable_period_payment = True

        if (month - 1) % 12 == 0:
            allowance_limit_this_year = _compute_allowance_limit_pence(balance, principal_pence, config)
            allowance_used_this_year = 0
            auto_target_used_this_year = 0

        opening_balance = balance
        interest = js_round(balance * monthly_rate)

        payment = (
            opening_balance + interest
            if month == total_term_months
            else min(current_payment, opening_balance + interest)
        )
        principal_portion = payment - interest
        balance -= principal_portion

        allowance_applies = not config.ercAppliesDuringFixedTermOnly or not is_variable_period
        manual_lump_sum_this_month = lump_sums_by_month.get(month, 0)

        effective_savings_pence = max(0, monthly_budget_pool_pence - payment)

        auto_pacing_active = allowance_applies or banked_destination != "lumpSumEachCycle"

        recurring_overpayment_pence = 0
        if overpayment_amount_mode == "fixed":
            recurring_overpayment_pence = fixed_monthly_overpayment_pence
        elif overpayment_amount_mode == "auto" and auto_pacing_active:
            target_allowance_limit_this_year = js_round((allowance_limit_this_year * target_utilization_pct) / 100)
            months_remaining_in_year = 12 - ((month - 1) % 12)
            remaining_target_pence = max(
                0,
                target_allowance_limit_this_year - auto_target_used_this_year - manual_lump_sum_this_month,
            )
            equal_monthly_installment_pence = js_round(remaining_target_pence / months_remaining_in_year)
            recurring_overpayment_pence = min(effective_savings_pence, equal_monthly_installment_pence)

        savings_added_this_month_pence = max(0, effective_savings_pence - recurring_overpayment_pence)
        savings_pot_pence += savings_added_this_month_pence

        if hybrid_committed:
            # Once committed, periodic payouts count from the commit
            # boundary rather than the (now long past) original fixed term —
            # same shape as stayOnVariable's formula, immediate first payout
            # right after committing, then every interval after that.
            # hybrid_committed already guarantees month > hybrid_committed_at_month.
            is_savings_payout_month = banked_destination == "lumpSumEachCycle" and (
                (month - hybrid_committed_at_month - 1) % savings_payout_interval_months == 0
            )
        else:
            is_savings_payout_month = banked_destination == "lumpSumEachCycle" and (
                previous_month_was_fixed_period_boundary
                if cycling_active
                else (
                    month > fixed_term_months
                    and (month - fixed_term_months - 1) % savings_payout_interval_months == 0
                )
            )
        payout_applied_pence = 0
        if is_savings_payout_month and savings_pot_pence > 0:
            payout_due = savings_pot_pence
            remaining_real_allowance = max(
                0,
                allowance_limit_this_year - allowance_used_this_year - manual_lump_sum_this_month - recurring_overpayment_pence,
            )
            payout_applied_pence = min(payout_due, remaining_real_allowance) if allowance_applies else payout_due
            savings_pot_pence -= payout_applied_pence

        lump_sum_component_wanted = manual_lump_sum_this_month + payout_applied_pence
        overpayment_wanted = recurring_overpayment_pence + lump_sum_component_wanted
        overpayment_applied = min(overpayment_wanted, balance)
        clip_ratio = overpayment_applied / overpayment_wanted if overpayment_wanted > 0 else 1
        lump_sum_paid_for_schedule = js_round(lump_sum_component_wanted * clip_ratio)

        erc_charged = 0
        if overpayment_applied > 0 and allowance_applies:
            remaining_allowance = max(0, allowance_limit_this_year - allowance_used_this_year)
            within_allowance = min(overpayment_applied, remaining_allowance)
            excess = overpayment_applied - within_allowance
            allowance_used_this_year += within_allowance
            if excess > 0:
                erc_charged = js_round((excess * config.ercRateOnExcessPct) / 100)
        auto_target_used_this_year += overpayment_applied

        balance -= overpayment_applied
        if balance < 0:
            balance = 0

        overpayment_clipped_pence = overpayment_wanted - overpayment_applied
        if overpayment_clipped_pence > 0:
            savings_sourced_pence = recurring_overpayment_pence + payout_applied_pence
            savings_pot_pence += min(overpayment_clipped_pence, savings_sourced_pence)

        is_fixed_period_boundary = (
            False
            if hybrid_committed
            else (
                position_in_cycle == fixed_term_months - 1
                if cycling_active
                else (fixed_term_months > 0 and month == fixed_term_months)
            )
        )

        if hybrid_active and hybrid_committed_at_month is None and is_fixed_period_boundary:
            # Boundary check: if we switched to the variable rate right now
            # and stayed, would the loan clear within this fixed deal's own
            # duration? If so, commit to variable permanently from here
            # instead of remortgaging into another fixed deal.
            would_clear = _would_clear_within_window_on_variable(
                balance_pence=balance,
                principal_pence=principal_pence,
                savings_pot_pence=savings_pot_pence,
                start_month=month + 1,
                remaining_total_term_months=int(total_term_months - month),
                window_months=int(fixed_term_months),
                variable_monthly_rate=variable_monthly_rate,
                config=config,
                overpayment_mode=mode,
                overpayment_amount_mode=overpayment_amount_mode,
                fixed_monthly_overpayment_pence=fixed_monthly_overpayment_pence,
                target_utilization_pct=target_utilization_pct,
                monthly_budget_pool_pence=monthly_budget_pool_pence,
                banked_destination=banked_destination,
                savings_payout_interval_months=savings_payout_interval_months,
                allowance_limit_this_year=allowance_limit_this_year,
                allowance_used_this_year=allowance_used_this_year,
                auto_target_used_this_year=auto_target_used_this_year,
            )
            if would_clear:
                hybrid_committed_at_month = month

        if mode == "reducePayment" and overpayment_applied > 0 and balance > 0:
            remaining_months = total_term_months - month
            if remaining_months > 0:
                current_payment = _calc_monthly_payment_pence(balance, monthly_rate, remaining_months)

        total_interest_pence += interest
        total_principal_pence += principal_portion
        total_overpaid_pence += overpayment_applied
        total_erc_pence += erc_charged

        schedule.append(
            MonthlyScheduleEntry(
                month=month,
                ratePct=rate_pct_now,
                openingBalance=pence_to_pounds(opening_balance),
                scheduledPayment=pence_to_pounds(payment),
                interestPaid=pence_to_pounds(interest),
                principalPaid=pence_to_pounds(principal_portion),
                overpaymentPaid=pence_to_pounds(overpayment_applied),
                lumpSumPaid=pence_to_pounds(lump_sum_paid_for_schedule),
                savingsAddedThisMonth=pence_to_pounds(savings_added_this_month_pence),
                savingsPotBalance=pence_to_pounds(savings_pot_pence),
                isFixedPeriodBoundary=is_fixed_period_boundary,
                ercCharged=pence_to_pounds(erc_charged),
                closingBalance=pence_to_pounds(balance),
            )
        )

        if balance <= 0:
            payoff_month = month
            break

        previous_month_was_fixed_period_boundary = is_fixed_period_boundary
        month += 1

    for lump_month in lump_sums_by_month.keys():
        if lump_month > payoff_month:
            # int(): atMonth is typed float (mirrors TS's untyped `number`,
            # validated as whole by validate_inputs), but display should
            # match TS's plain numeric-to-string coercion (e.g. "100", not
            # "100.0").
            warnings.append(
                f"A lump sum scheduled for month {int(lump_month)} was ignored because the mortgage is already paid off by month {payoff_month}."
            )

    if savings_pot_pence > 0:
        pot_pounds = pence_to_pounds(savings_pot_pence)
        # js_round(), not Python's format-spec rounding: Python's `:.0f`
        # uses round-half-to-even, but JS's toLocaleString (used on the TS
        # side) rounds half away from zero — they disagree on exact .5
        # boundaries, which the cross-check script caught.
        pot_pounds_str = f"{js_round(pot_pounds):,}"
        warnings.append(
            f"You have £{pot_pounds_str} in banked savings that never reached a lump-sum payout point — it stays in your savings, not applied to the mortgage."
        )

    return MortgageResult(
        schedule=schedule,
        principal=pence_to_pounds(principal_pence),
        initialMonthlyPayment=pence_to_pounds(initial_monthly_payment_pence),
        variablePeriodMonthlyPayment=pence_to_pounds(variable_period_monthly_payment_pence),
        rateAfterFixedTermMode=rate_after_fixed_term_mode,
        payoffMonth=payoff_month,
        totalInterestPaid=pence_to_pounds(total_interest_pence),
        totalPrincipalPaid=pence_to_pounds(total_principal_pence),
        totalOverpaid=pence_to_pounds(total_overpaid_pence),
        totalErcPaid=pence_to_pounds(total_erc_pence),
        totalRepaid=pence_to_pounds(total_interest_pence + total_principal_pence + total_overpaid_pence + total_erc_pence),
        monthsSavedVsOriginalTerm=total_term_months - payoff_month,
        unallocatedSavingsPot=pence_to_pounds(savings_pot_pence),
        warnings=warnings,
    )


def compare_with_and_without_overpayments(
    inputs: MortgageInputs, defaults: Optional[MortgageDefaults] = None
) -> ComparisonResult:
    with_overpayments = calculate_mortgage(inputs, defaults)
    without_inputs = inputs.model_copy(
        update={
            "lumpSums": [],
            "monthlyOverpaymentAmountMode": "none",
            "bankedSavingsDestination": "keepAsSavings",
        }
    )
    without_overpayments = calculate_mortgage(without_inputs, defaults)

    return ComparisonResult(
        withOverpayments=with_overpayments,
        withoutOverpayments=without_overpayments,
        interestSaved=without_overpayments.totalInterestPaid - with_overpayments.totalInterestPaid,
        monthsSaved=without_overpayments.payoffMonth - with_overpayments.payoffMonth,
    )

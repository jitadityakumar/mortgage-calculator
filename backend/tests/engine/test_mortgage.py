import math

import pytest

from app.engine import (
    DEFAULT_DEPOSIT,
    MortgageValidationError,
    calculate_mortgage,
    compare_with_and_without_overpayments,
)
from app.engine.types import MortgageInputs


def reference_monthly_payment(principal: float, annual_pct: float, months: int) -> float:
    """Independent reference implementation of the standard annuity formula, kept
    deliberately separate from app.engine so tests don't just check the code
    agrees with itself."""
    r = annual_pct / 100 / 12
    if r == 0:
        return principal / months
    factor = (1 + r) ** months
    return (principal * r * factor) / (factor - 1)


def base_inputs(overrides: dict | None = None) -> MortgageInputs:
    data = {
        "propertyValue": 250_000,
        "deposit": 50_000,
        "fixedRateAnnualPct": 5,
        "fixedTermMonths": 300,
        "variableRateAnnualPct": 5,
        "totalTermMonths": 300,
    }
    if overrides:
        data.update(overrides)
    return MortgageInputs(**data)


def fixed_overpayment(amount: float) -> dict:
    """Shorthand for a static, unconditional monthly overpayment (the old flat "monthlyOverpayment" field)."""
    return {"monthlyOverpaymentAmountMode": "fixed", "fixedMonthlyOverpayment": amount}


# calculateMortgage — core amortization


def test_matches_the_standard_annuity_formula_for_a_plain_no_overpayment_loan():
    inputs = base_inputs()
    result = calculate_mortgage(inputs)
    expected_payment = reference_monthly_payment(200_000, 5, 300)

    assert result.principal == 200_000
    assert result.initialMonthlyPayment == pytest.approx(expected_payment, abs=0.05)
    # Known reference value for £200,000 / 5% / 25yr (300mo) ≈ £1,169.18/mo.
    assert result.initialMonthlyPayment == pytest.approx(1169.18, abs=0.05)


def test_fully_amortizes_schedule_ends_at_exactly_zero_balance_with_no_negative_dip():
    result = calculate_mortgage(base_inputs())
    assert len(result.schedule) == 300
    assert result.schedule[-1].closingBalance == 0
    for entry in result.schedule:
        assert entry.closingBalance >= 0


def test_sum_of_principal_paid_across_the_schedule_equals_the_loan_amount():
    result = calculate_mortgage(base_inputs())
    total_principal_from_schedule = sum(e.principalPaid for e in result.schedule)
    assert total_principal_from_schedule == pytest.approx(result.principal, abs=0.05)
    assert result.totalPrincipalPaid == pytest.approx(result.principal, abs=0.05)


def test_special_cases_a_0_pct_interest_rate_instead_of_dividing_by_zero():
    result = calculate_mortgage(
        base_inputs({"fixedRateAnnualPct": 0, "variableRateAnnualPct": 0})
    )
    assert result.initialMonthlyPayment == pytest.approx(200_000 / 300, abs=0.005)
    assert result.totalInterestPaid == 0
    assert result.schedule[-1].closingBalance == 0


# calculateMortgage — fixed to variable rate transition (no cycling)


def test_recasts_the_payment_at_the_fixed_variable_boundary_using_the_actual_remaining_balance():
    # rateAfterFixedTermMode defaults to 'stayOnVariable' at the engine level, so
    # this is the simple single fixed -> follow-on-forever schedule.
    inputs = base_inputs({"fixedTermMonths": 60, "variableRateAnnualPct": 7.25})
    result = calculate_mortgage(inputs)

    last_fixed_month = result.schedule[59]
    first_variable_month = result.schedule[60]
    assert last_fixed_month.ratePct == 5
    assert first_variable_month.ratePct == 7.25
    assert last_fixed_month.isFixedPeriodBoundary is True

    remaining_balance = last_fixed_month.closingBalance
    expected_recast_payment = reference_monthly_payment(remaining_balance, 7.25, 300 - 60)
    assert result.variablePeriodMonthlyPayment == pytest.approx(expected_recast_payment, abs=0.05)
    assert first_variable_month.scheduledPayment == pytest.approx(expected_recast_payment, abs=0.05)

    # Payment actually changes at the boundary (rates differ meaningfully here).
    assert first_variable_month.scheduledPayment != pytest.approx(last_fixed_month.scheduledPayment, abs=0.5)

    # Never re-fixes: stays on the variable rate for the rest of the term.
    assert all(e.ratePct == 7.25 for e in result.schedule[60:])


def test_never_enters_a_variable_period_if_fixed_term_months_equals_total_term_months():
    result = calculate_mortgage(base_inputs({"fixedTermMonths": 300, "variableRateAnnualPct": 99}))
    assert result.variablePeriodMonthlyPayment == 0
    assert all(e.ratePct == 5 for e in result.schedule)


# calculateMortgage — overpayments (fixed amount)


def test_reduce_term_mode_keeps_the_scheduled_payment_constant_and_pays_off_early():
    inputs = base_inputs(
        {
            "fixedTermMonths": 300,
            "overpaymentMode": "reduceTerm",
            **fixed_overpayment(300),
        }
    )
    result = calculate_mortgage(inputs)

    assert result.payoffMonth < 300
    assert result.monthsSavedVsOriginalTerm == 300 - result.payoffMonth

    # Scheduled payment should stay constant through the bulk of the schedule —
    # only the tail end (as the balance runs out) and the overpayment portion
    # change, not the base scheduled payment itself.
    safe_middle_range = result.schedule[1 : math.floor(result.payoffMonth * 0.8)]
    assert len(safe_middle_range) > 10
    first = safe_middle_range[0].scheduledPayment
    for entry in safe_middle_range:
        assert entry.scheduledPayment == pytest.approx(first, abs=0.05)


def test_reduce_payment_mode_payments_decline_over_time_instead_of_staying_flat():
    inputs = base_inputs(
        {
            "fixedTermMonths": 300,
            "overpaymentMode": "reducePayment",
            **fixed_overpayment(300),
        }
    )
    result = calculate_mortgage(inputs)

    early_payment = result.schedule[5].scheduledPayment
    late_payment = result.schedule[200].scheduledPayment
    assert late_payment < early_payment


def test_reduce_payment_mode_never_pays_off_earlier_than_reduce_term_mode_for_the_same_overpayment():
    # Injecting extra cash every month always accelerates payoff to some degree —
    # no recalculation scheme can hold the term exactly fixed while that happens.
    # reduceTerm maximizes the acceleration (payment never drops); reducePayment
    # spreads the benefit into declining payments instead, so it should finish
    # at the same time or later than reduceTerm, never earlier.
    reduce_term_result = calculate_mortgage(
        base_inputs({"overpaymentMode": "reduceTerm", **fixed_overpayment(300)})
    )
    reduce_payment_result = calculate_mortgage(
        base_inputs({"overpaymentMode": "reducePayment", **fixed_overpayment(300)})
    )
    assert reduce_payment_result.payoffMonth >= reduce_term_result.payoffMonth
    assert reduce_payment_result.payoffMonth <= 300


def test_both_overpayment_modes_reduce_total_interest_vs_the_no_overpayment_baseline():
    with_reduce_term = compare_with_and_without_overpayments(
        base_inputs({"overpaymentMode": "reduceTerm", **fixed_overpayment(250)})
    )
    assert with_reduce_term.interestSaved > 0
    assert with_reduce_term.monthsSaved > 0

    with_reduce_payment = compare_with_and_without_overpayments(
        base_inputs({"overpaymentMode": "reducePayment", **fixed_overpayment(250)})
    )
    assert with_reduce_payment.interestSaved > 0
    assert with_reduce_payment.monthsSaved >= 0
    assert with_reduce_payment.monthsSaved <= with_reduce_term.monthsSaved


def test_no_overpayment_inputs_comparison_shows_zero_savings():
    comparison = compare_with_and_without_overpayments(base_inputs())
    assert comparison.interestSaved == 0
    assert comparison.monthsSaved == 0


def test_applies_a_lump_sum_at_the_specified_month_dropping_the_balance_beyond_the_scheduled_principal():
    with_lump = calculate_mortgage(
        base_inputs({"lumpSums": [{"atMonth": 12, "amount": 10_000}]})
    )
    without_lump = calculate_mortgage(base_inputs())

    drop_with = without_lump.schedule[10].closingBalance - with_lump.schedule[11].closingBalance
    # Balance should have fallen by roughly the scheduled principal *plus* the £10k lump sum.
    assert drop_with > 9_000
    assert with_lump.payoffMonth < without_lump.payoffMonth
    assert with_lump.schedule[11].lumpSumPaid == pytest.approx(10_000, abs=0.05)


def test_warns_but_does_not_fail_when_a_lump_sum_is_scheduled_after_the_mortgage_is_already_paid_off():
    result = calculate_mortgage(
        base_inputs(
            {
                "lumpSums": [{"atMonth": 299, "amount": 1_000}],
                **fixed_overpayment(5_000),  # pays off very early
            }
        )
    )
    assert result.payoffMonth < 100
    assert any("month 299" in w for w in result.warnings)


def test_caps_overpayment_at_the_remaining_balance_instead_of_driving_it_negative():
    result = calculate_mortgage(base_inputs(fixed_overpayment(50_000)))
    for entry in result.schedule:
        assert entry.closingBalance >= 0
    assert result.schedule[-1].closingBalance == 0


# calculateMortgage — overpayment allowance & ERC


def test_charges_an_erc_on_overpayments_exceeding_the_allowance_during_the_fixed_term():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "config": {
                    "annualOverpaymentAllowancePct": 10,
                    "ercRateOnExcessPct": 3,
                    "ercAppliesDuringFixedTermOnly": True,
                },
                # deliberately huge relative to a £200k loan to blow past a 10% allowance fast
                **fixed_overpayment(2_000),
            }
        )
    )
    total_erc = result.totalErcPaid
    assert total_erc > 0


def test_does_not_charge_an_erc_once_the_loan_has_moved_to_the_variable_period():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 12,
                "config": {
                    "annualOverpaymentAllowancePct": 10,
                    "ercRateOnExcessPct": 3,
                    "ercAppliesDuringFixedTermOnly": True,
                },
                **fixed_overpayment(2_000),
            }
        )
    )
    variable_period_entries = [e for e in result.schedule if e.month > 12]
    assert all(e.ercCharged == 0 for e in variable_period_entries)


def test_never_charges_an_erc_when_overpayments_stay_within_the_allowance():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 300,
                "config": {"annualOverpaymentAllowancePct": 10, "ercRateOnExcessPct": 3},
                # small relative to a £200k loan — well within a 10% annual allowance
                **fixed_overpayment(50),
            }
        )
    )
    assert result.totalErcPaid == 0


# calculateMortgage — validation


def test_rejects_a_deposit_greater_than_or_equal_to_the_property_value():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"deposit": 250_000}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"deposit": 300_000}))


def test_rejects_negative_rates():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"fixedRateAnnualPct": -1}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"variableRateAnnualPct": -1}))


def test_rejects_a_fixed_term_longer_than_the_total_term():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"fixedTermMonths": 301, "totalTermMonths": 300}))


def test_rejects_a_non_positive_total_term():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"totalTermMonths": 0}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"totalTermMonths": -12}))


def test_rejects_a_negative_deposit():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"deposit": -1}))


def test_rejects_a_target_allowance_utilization_outside_0_100():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"targetAllowanceUtilizationPct": -1}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"targetAllowanceUtilizationPct": 101}))


def test_rejects_a_negative_or_non_integer_remortgage_gap():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"remortgageGapMonths": -1}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"remortgageGapMonths": 1.5}))


def test_rejects_a_non_positive_savings_payout_interval_but_allows_fractional_years():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"savingsPayoutIntervalYears": 0}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"savingsPayoutIntervalYears": -1}))
    # 0.25 (3 months) and 0.5 (6 months) must be valid, not rejected as non-integer.
    calculate_mortgage(base_inputs({"savingsPayoutIntervalYears": 0.25}))
    calculate_mortgage(base_inputs({"savingsPayoutIntervalYears": 0.5}))


def test_collects_multiple_issues_in_a_single_error():
    with pytest.raises(MortgageValidationError) as exc_info:
        calculate_mortgage(
            base_inputs({"deposit": 300_000, "fixedRateAnnualPct": -2, "totalTermMonths": 0})
        )
    assert len(exc_info.value.issues) >= 3


# calculateMortgage — rounding robustness


def test_always_lands_on_exactly_zero_balance_even_with_an_awkward_rate_term_combination():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedRateAnnualPct": 4.37,
                "variableRateAnnualPct": 6.89,
                "fixedTermMonths": 91,
                "totalTermMonths": 187,
            }
        )
    )
    assert result.schedule[-1].closingBalance == 0


def test_lands_on_exactly_zero_balance_when_overpayments_cause_an_early_payoff():
    result = calculate_mortgage(base_inputs(fixed_overpayment(733)))
    assert result.schedule[-1].closingBalance == 0
    assert result.payoffMonth == len(result.schedule)


# calculateMortgage — savings pool (currentRent + monthlySavings)


def test_mode_none_with_destination_keep_as_savings_the_pool_has_zero_effect_on_the_mortgage():
    with_pool = calculate_mortgage(
        base_inputs(
            {
                "currentRent": 2000,
                "monthlySavings": 500,
                "monthlyOverpaymentAmountMode": "none",
                "bankedSavingsDestination": "keepAsSavings",
            }
        )
    )
    without_pool = calculate_mortgage(base_inputs())
    assert with_pool.payoffMonth == without_pool.payoffMonth
    assert with_pool.totalOverpaid == 0


def test_mode_auto_applies_current_rent_plus_monthly_savings_minus_scheduled_payment_as_overpayment_when_it_fits_the_allowance():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 300,
                "currentRent": 1000,
                "monthlySavings": 400,
                "monthlyOverpaymentAmountMode": "auto",
            }
        )
    )
    month1 = result.schedule[0]
    expected_overpayment = max(0, 1000 + 400 - month1.scheduledPayment)
    assert month1.overpaymentPaid == pytest.approx(expected_overpayment, abs=0.05)
    assert result.payoffMonth < 300


def test_mode_auto_never_applies_a_negative_overpayment_when_the_pool_is_smaller_than_the_payment():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 300,
                "currentRent": 100,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
            }
        )
    )
    # Initial payment is ~£1,169 (see the annuity-formula test above) — a £100 pool covers none of it.
    assert result.schedule[0].overpaymentPaid == 0


def test_mode_fixed_applies_exactly_the_chosen_amount_and_banks_the_rest_of_the_pool():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 300,
                "currentRent": 1000,
                "monthlySavings": 400,
                "monthlyOverpaymentAmountMode": "fixed",
                "fixedMonthlyOverpayment": 300,
                "bankedSavingsDestination": "keepAsSavings",
            }
        )
    )
    month1 = result.schedule[0]
    assert month1.overpaymentPaid == pytest.approx(300, abs=0.05)
    expected_banked = max(0, 1000 + 400 - month1.scheduledPayment - 300)
    assert month1.savingsPotBalance == pytest.approx(expected_banked, abs=0.05)


def test_mode_fixed_applies_the_amount_unconditionally_even_with_no_rent_savings_pool_at_all():
    result = calculate_mortgage(base_inputs(fixed_overpayment(300)))
    assert result.schedule[0].overpaymentPaid == pytest.approx(300, abs=0.05)
    assert result.schedule[0].savingsPotBalance == 0


def test_mode_none_with_destination_lump_sum_each_cycle_banks_the_entire_pool_for_a_lump_sum_only_strategy():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 3000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "none",
                "bankedSavingsDestination": "lumpSumEachCycle",
            }
        )
    )
    assert result.schedule[0].overpaymentPaid == 0
    assert result.schedule[0].savingsPotBalance > 0
    # A lump sum eventually lands even though there's no recurring overpayment —
    # and even though rateAfterFixedTermMode is left at its default
    # ('stayOnVariable'), since the payout schedule doesn't depend on it.
    assert any(e.lumpSumPaid > 0 for e in result.schedule)


def test_a_lower_target_allowance_utilization_pct_banks_more_and_overpays_less_in_auto_mode():
    full = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 5000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
                "targetAllowanceUtilizationPct": 100,
            }
        )
    )
    half = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 5000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
                "targetAllowanceUtilizationPct": 50,
            }
        )
    )
    # A £5,000/month pool comfortably exceeds the equal-monthly-installment pace
    # implied by even the full 10% annual allowance, so the installment (not the
    # pool) binds every month — compare 12-month totals since a single month's
    # installment is a near-constant fraction of the annual target either way.
    def sum_overpaid(r):
        return sum(e.overpaymentPaid for e in r.schedule[:12])

    assert sum_overpaid(half) < sum_overpaid(full)
    assert half.schedule[11].savingsPotBalance > full.schedule[11].savingsPotBalance
    # Never triggers an ERC regardless of the target.
    assert full.totalErcPaid == 0
    assert half.totalErcPaid == 0


def test_auto_mode_paces_evenly_within_each_allowance_year_even_once_permanently_past_the_fixed_term_no_erc_risk():
    # Regression: allowanceUsedThisYear (which the 'auto' pacing formula relied on
    # to know how much of the year's target was already used) is only updated
    # when allowanceApplies is true — i.e. only while ERC risk actually exists.
    # Once permanently on the variable rate with the default
    # ercAppliesDuringFixedTermOnly: true, allowanceApplies is false forever, so
    # that variable never moved again: the pacing formula kept thinking none of
    # the target had been used, and divided an undiminished target by a shrinking
    # "months remaining in year" count, ramping the monthly installment up every
    # month before clipping flat against available cash near the end of each
    # year — a visible, wrong-looking sawtooth in the schedule's Overpayment
    # column, caught by inspecting the live app's amortization table.
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 3000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
                "targetAllowanceUtilizationPct": 50,
            }
        )
    )

    def recurring(i):
        return result.schedule[i].overpaymentPaid - result.schedule[i].lumpSumPaid

    # Months 25-36 (index 24-35): one full allowance year, entirely in the
    # permanently-variable period. Should stay flat, not ramp.
    first_month_of_year = recurring(24)
    for i in range(25, 36):
        assert recurring(i) == pytest.approx(first_month_of_year, abs=0.05)


def test_auto_mode_stops_the_monthly_drip_once_past_the_fixed_term_when_banked_savings_destination_is_lump_sum_each_cycle_no_erc_risk_periodic_payout_handles_it_instead():
    # Contrast with the 'keepAsSavings' case above: once ERC risk is gone AND a
    # periodic lump-sum payout is already going to sweep the banked pot onto the
    # mortgage, pacing a parallel monthly drip serves no purpose — it only
    # recategorizes money from "lump sum" to "recurring overpayment" in the
    # schedule, one month earlier than the payout would anyway. It should bank
    # entirely and show up as a lump sum instead.
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 3000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
                "targetAllowanceUtilizationPct": 50,
                "bankedSavingsDestination": "lumpSumEachCycle",
                "savingsPayoutIntervalYears": 1,
            }
        )
    )

    def recurring(i):
        return result.schedule[i].overpaymentPaid - result.schedule[i].lumpSumPaid

    # Months 25-36 (index 24-35): one full allowance year, entirely past the
    # fixed term. No recurring drip at all — everything banks toward the payout.
    for i in range(24, 36):
        assert recurring(i) == pytest.approx(0, abs=0.05)
    # The payout itself still lands and clears real money onto the mortgage.
    assert any(e.lumpSumPaid > 0 for e in result.schedule)


def test_effective_savings_grows_as_the_payment_falls_under_reduce_payment_mode():
    result = calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 300,
                "overpaymentMode": "reducePayment",
                "currentRent": 1500,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
            }
        )
    )
    early_overpayment = result.schedule[5].overpaymentPaid
    later_overpayment = result.schedule[100].overpaymentPaid
    assert later_overpayment > early_overpayment


def test_does_not_divide_by_zero_when_fixed_term_months_is_0_no_fixed_period_at_all():
    calculate_mortgage(
        base_inputs(
            {
                "fixedTermMonths": 0,
                "currentRent": 2000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
            }
        )
    )


def test_compare_with_and_without_overpayments_ignores_the_savings_pool_entirely_in_the_baseline():
    comparison = compare_with_and_without_overpayments(
        base_inputs(
            {
                "fixedTermMonths": 24,
                "currentRent": 5000,
                "monthlySavings": 0,
                "monthlyOverpaymentAmountMode": "auto",
                "bankedSavingsDestination": "lumpSumEachCycle",
            }
        )
    )
    assert comparison.withoutOverpayments.totalOverpaid == 0
    assert comparison.withoutOverpayments.payoffMonth == 300


# calculateMortgage — rate cycling (rateAfterFixedTermMode)


def cycling_inputs(overrides: dict | None = None) -> MortgageInputs:
    data = {
        "totalTermMonths": 300,
        "fixedTermMonths": 24,
        "variableRateAnnualPct": 7.25,
        "rateAfterFixedTermMode": "remortgageToNewFixed",
        "remortgageGapMonths": 2,
    }
    if overrides:
        data.update(overrides)
    return base_inputs(data)


def test_the_rate_cycles_fixed_gap_on_variable_fixed_recasting_the_payment_at_each_transition():
    result = calculate_mortgage(cycling_inputs())

    # Cycle 0: months 1-24 fixed, 25-26 gap (variable), cycle 1: 27-50 fixed, 51-52 gap, ...
    assert all(e.ratePct == 5 for e in result.schedule[0:24])
    assert result.schedule[24].ratePct == 7.25  # month 25
    assert result.schedule[25].ratePct == 7.25  # month 26
    assert result.schedule[26].ratePct == 5  # month 27: back to fixed
    assert all(e.ratePct == 5 for e in result.schedule[26:50])
    assert result.schedule[50].ratePct == 7.25  # month 51

    # Payment actually changes at the first transition (rates differ meaningfully).
    assert result.schedule[23].scheduledPayment != pytest.approx(result.schedule[24].scheduledPayment, abs=0.5)

    # isFixedPeriodBoundary marks the last month of each fixed portion, accounting
    # for the gap (month 50, not 49, since the fixed portion is months 27-50).
    assert result.schedule[23].isFixedPeriodBoundary is True  # month 24
    assert result.schedule[49].isFixedPeriodBoundary is True  # month 50


def test_does_not_cycle_the_rate_when_rate_after_fixed_term_mode_is_stay_on_variable():
    result = calculate_mortgage(cycling_inputs({"rateAfterFixedTermMode": "stayOnVariable"}))
    # Simple single fixed -> follow-on-forever schedule instead.
    assert all(e.ratePct == 5 for e in result.schedule[0:24])
    assert all(e.ratePct == 7.25 for e in result.schedule[24:])


def test_never_enters_a_variable_period_with_a_zero_month_gap_no_room_to_leave_the_fixed_tie_in():
    result = calculate_mortgage(cycling_inputs({"remortgageGapMonths": 0}))
    assert all(e.ratePct == 5 for e in result.schedule)


# calculateMortgage — savings payout, staying on the variable rate (periodic, savingsPayoutIntervalYears)


def payout_inputs(overrides: dict | None = None) -> MortgageInputs:
    data = {
        "totalTermMonths": 300,
        "fixedTermMonths": 24,
        "variableRateAnnualPct": 7.25,
        "currentRent": 5000,
        "monthlySavings": 0,
        "monthlyOverpaymentAmountMode": "auto",
        "bankedSavingsDestination": "lumpSumEachCycle",
        "rateAfterFixedTermMode": "stayOnVariable",
    }
    if overrides:
        data.update(overrides)
    return base_inputs(data)


def test_mode_auto_never_triggers_an_erc_on_its_own_stays_within_the_penalty_free_allowance():
    result = calculate_mortgage(
        payout_inputs(
            {
                "config": {
                    "annualOverpaymentAllowancePct": 10,
                    "ercRateOnExcessPct": 3,
                    "ercAppliesDuringFixedTermOnly": True,
                }
            }
        )
    )
    assert result.totalErcPaid == 0


def test_never_triggers_an_erc_even_when_erc_applies_past_the_fixed_term_erc_applies_during_fixed_term_only_false():
    # Regression: a payout used to be paid out uncapped. That's penalty-free only
    # when ERC is confined to the fixed term. With ERC applying for the whole
    # term, an uncapped payout would blow through the annual allowance and incur
    # an ERC — defeating the entire point of banking it. The payout must be
    # re-metered against the allowance every time it fires.
    result = calculate_mortgage(
        payout_inputs(
            {
                "config": {
                    "annualOverpaymentAllowancePct": 10,
                    "ercRateOnExcessPct": 3,
                    "ercAppliesDuringFixedTermOnly": False,
                }
            }
        )
    )
    assert result.totalErcPaid == 0
    # Savings that couldn't apply penalty-free stay banked and are reported, not lost.
    assert result.unallocatedSavingsPot > 0


def test_pays_out_the_banked_pot_the_month_the_fixed_term_ends_then_every_savings_payout_interval_years_after_that():
    # Regression: the rate-cycling refactor accidentally coupled this mechanism
    # entirely to remortgaging into a new fixed deal, so it silently stopped
    # firing at all under rateAfterFixedTermMode: 'stayOnVariable'. Periodic
    # payouts must work regardless of what the rate does afterwards.
    result = calculate_mortgage(payout_inputs({"savingsPayoutIntervalYears": 1}))
    # No payout during the fixed term itself.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[0:24])
    # First payout the month the fixed term ends (month 25), not delayed by a
    # full interval.
    assert result.schedule[24].lumpSumPaid > 0
    # Not again until a full interval (1 year = 12 months) has passed.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[25:36])
    # Repeats every 12 months after that (month 37).
    assert result.schedule[36].lumpSumPaid > 0


def test_supports_fractional_years_0_25_for_3_months_0_5_for_6_months():
    quarterly = calculate_mortgage(payout_inputs({"savingsPayoutIntervalYears": 0.25}))
    # First payout month 25, next 3 months later at month 28.
    assert quarterly.schedule[24].lumpSumPaid > 0
    assert all(e.lumpSumPaid == 0 for e in quarterly.schedule[25:27])
    assert quarterly.schedule[27].lumpSumPaid > 0  # month 28

    semi_annual = calculate_mortgage(payout_inputs({"savingsPayoutIntervalYears": 0.5}))
    assert semi_annual.schedule[24].lumpSumPaid > 0
    assert all(e.lumpSumPaid == 0 for e in semi_annual.schedule[25:30])
    assert semi_annual.schedule[30].lumpSumPaid > 0  # month 31


def test_a_shorter_payout_interval_pays_out_more_often_than_a_longer_one():
    frequent = calculate_mortgage(payout_inputs({"savingsPayoutIntervalYears": 0.5}))
    infrequent = calculate_mortgage(payout_inputs({"savingsPayoutIntervalYears": 2}))

    def payout_count(r):
        return len([e for e in r.schedule if e.lumpSumPaid > 0])

    assert payout_count(frequent) > payout_count(infrequent)


def test_reports_unallocated_savings_when_there_is_no_room_to_ever_leave_the_fixed_term():
    result = calculate_mortgage(payout_inputs({"fixedTermMonths": 300, "totalTermMonths": 300}))
    assert result.unallocatedSavingsPot > 0
    assert all(e.lumpSumPaid == 0 for e in result.schedule)


def test_conserves_every_pound_of_banked_savings_when_a_payout_overshoots_the_payoff_month():
    # Regression: when the intended overpayment (recurring pool contribution +
    # a payout) exceeds the remaining balance on the final month, the engine
    # used to clip it to the balance and silently drop the overshoot. With a
    # huge pool against a tiny loan, that dropped hundreds of thousands of
    # pounds of the borrower's own banked savings out of the reported total.
    # In 'auto' mode with no manual lump sums, no pocket money is injected, so
    # every pound of freed-up pool money must land either on the mortgage
    # (totalOverpaid) or in the unallocated savings pot — nothing may vanish.
    inputs = payout_inputs(
        {
            "savingsPayoutIntervalYears": 1,
            "propertyValue": 120_000,
            "deposit": 60_000,
            "currentRent": 20_000,
            "monthlySavings": 10_000,
        }
    )
    result = calculate_mortgage(inputs)
    pool = (inputs.currentRent or 0) + (inputs.monthlySavings or 0)
    # Pool money freed up each active month, in pence to match the engine.
    pool_in_pence = sum(
        max(0, round(pool * 100) - round(e.scheduledPayment * 100)) for e in result.schedule
    )
    accounted_pence = round(result.totalOverpaid * 100) + round(result.unallocatedSavingsPot * 100)
    assert pool_in_pence - accounted_pence == 0
    # And the overshoot really is large here — guards against the test passing
    # only because the scenario is trivial.
    assert result.unallocatedSavingsPot > 500_000


# calculateMortgage — savings payout, cycling into new fixed deals (cycle-boundary timed)


def cycling_payout_inputs(overrides: dict | None = None) -> MortgageInputs:
    data = {
        "totalTermMonths": 300,
        "fixedTermMonths": 24,
        "variableRateAnnualPct": 7.25,
        "currentRent": 5000,
        "monthlySavings": 0,
        "monthlyOverpaymentAmountMode": "none",
        "bankedSavingsDestination": "lumpSumEachCycle",
        "rateAfterFixedTermMode": "remortgageToNewFixed",
        "remortgageGapMonths": 2,
    }
    if overrides:
        data.update(overrides)
    return base_inputs(data)


def test_pays_out_the_month_immediately_after_each_fixed_deal_ends_repeating_every_cycle_ignoring_savings_payout_interval_years_entirely():
    # mode 'none' (no competing recurring overpayment) isolates the payout
    # mechanism's timing: with cycling active, a payout should land right after
    # each remortgage point regardless of any calendar interval set.
    result = calculate_mortgage(cycling_payout_inputs({"savingsPayoutIntervalYears": 5}))
    # Cycle boundaries at months 24 and 50 (26-month cycle: 24 fixed + 2 gap) —
    # payouts land the month immediately after each one, not tied to the
    # (deliberately huge, 5-year) interval above.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[0:24])
    assert result.schedule[24].lumpSumPaid > 0  # month 25
    assert result.schedule[50].lumpSumPaid > 0  # month 51
    assert result.totalErcPaid == 0


def test_never_triggers_an_erc_re_metering_the_payout_against_the_allowance_even_when_it_lands_inside_a_subsequent_fixed_deal():
    result = calculate_mortgage(
        cycling_payout_inputs(
            {
                "config": {
                    "annualOverpaymentAllowancePct": 10,
                    "ercRateOnExcessPct": 3,
                    "ercAppliesDuringFixedTermOnly": False,
                }
            }
        )
    )
    assert result.totalErcPaid == 0


def test_a_zero_month_gap_means_never_leaving_the_fixed_tie_in_so_payouts_stay_allowance_capped_instead_of_dumping_in_full():
    # Confirms the same reasoning as the original (pre-decoupling) design: no gap
    # => no genuine penalty-free window, so a payout still fires at each cycle
    # boundary (previousMonthWasFixedPeriodBoundary still flips true) but stays
    # capped by the allowance every time rather than getting a free pass, since
    # the rate itself never actually leaves the fixed regime.
    result = calculate_mortgage(cycling_payout_inputs({"remortgageGapMonths": 0}))
    assert all(e.ratePct == 5 for e in result.schedule)
    assert result.schedule[24].lumpSumPaid > 0  # month 25: capped payout
    assert result.totalErcPaid == 0
    # Capped every cycle, so savings pile up rather than fully clearing.
    assert result.unallocatedSavingsPot > 0


def test_calculate_fills_in_defaults_when_only_property_value_is_given():
    result = calculate_mortgage(MortgageInputs(propertyValue=250_000))
    # Flat default deposit (DEFAULT_DEPOSIT, from defaults.json) -> principal
    # is propertyValue minus that flat amount, not a percentage.
    assert result.principal == 250_000 - DEFAULT_DEPOSIT
    assert len(result.schedule) == 300


def test_calculate_only_fills_defaults_for_fields_left_unset():
    explicit = calculate_mortgage(
        MortgageInputs(propertyValue=250_000, deposit=50_000, fixedRateAnnualPct=5)
    )
    defaulted_deposit = calculate_mortgage(MortgageInputs(propertyValue=250_000, fixedRateAnnualPct=5))
    assert explicit.principal == 200_000
    # Caller-supplied fields are untouched by default-filling.
    assert explicit.schedule[0].ratePct == 5
    assert defaulted_deposit.principal == 250_000 - DEFAULT_DEPOSIT


def test_calculate_with_all_fields_given_ignores_defaults_entirely():
    inputs = base_inputs()
    result = calculate_mortgage(inputs)
    # base_inputs() supplies every field explicitly; equivalent to calling
    # resolve_mortgage_inputs() as a no-op.
    assert result.principal == 200_000
    assert len(result.schedule) == 300

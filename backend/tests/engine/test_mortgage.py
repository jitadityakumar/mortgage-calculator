import math

import pytest

from app.engine import (
    MortgageValidationError,
    calculate_mortgage,
    calculate_sdlt,
    compare_with_and_without_overpayments,
    load_seed_defaults,
)
from app.engine.types import MortgageInputs

_SEED = load_seed_defaults()
DEFAULT_DEPOSIT = _SEED.deposit
# deriveDepositFromSavings is on in the seed, so a request that omits
# `deposit` actually resolves via depositSavings minus SDLT — see
# resolve_mortgage_inputs().
DERIVED_DEPOSIT_250K = max(0, round(_SEED.depositSavings - calculate_sdlt(250_000, _SEED.isFirstTimeBuyer).totalTax))


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
        # Most tests below assert on `result.schedule` directly.
        "includeSchedule": True,
        "propertyValue": 250_000,
        "deposit": 50_000,
        "fixedRateAnnualPct": 5,
        "fixedTermMonths": 300,
        "variableRateAnnualPct": 5,
        "totalTermMonths": 300,
        # Explicit zero pool: currentRent/monthlySavings/serviceCharge now
        # resolve from the admin-editable defaults (like fixedMonthlyOverpayment)
        # when unset, which would otherwise inject a real overpayment pool into
        # every "plain loan" test below. Tests that want a real pool override
        # these explicitly.
        "currentRent": 0,
        "monthlySavings": 0,
        "serviceCharge": 0,
        # Explicit stayOnVariable: rateAfterFixedTermMode now resolves from the
        # admin-editable defaults (shipped default: remortgageToNewFixed) when
        # unset, which would otherwise remortgage-cycle every "plain loan" test
        # below instead of running the simple fixed -> follow-on-forever
        # schedule they assume. Tests that want cycling override this explicitly.
        "rateAfterFixedTermMode": "stayOnVariable",
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
    assert result.monthlyPayments[0].fromMonth == 1
    assert result.monthlyPayments[0].isVariable is False
    assert result.monthlyPayments[0].payment == pytest.approx(expected_payment, abs=0.05)
    # Known reference value for £200,000 / 5% / 25yr (300mo) ≈ £1,169.18/mo.
    assert result.monthlyPayments[0].payment == pytest.approx(1169.18, abs=0.05)


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
    assert result.monthlyPayments[0].payment == pytest.approx(200_000 / 300, abs=0.005)
    assert result.totalInterestPaid == 0
    assert result.schedule[-1].closingBalance == 0


# calculateMortgage — fixed to variable rate transition (no cycling)


def test_recasts_the_payment_at_the_fixed_variable_boundary_using_the_actual_remaining_balance():
    # base_inputs() sets rateAfterFixedTermMode explicitly to stayOnVariable, so
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
    assert len(result.monthlyPayments) == 2
    assert result.monthlyPayments[1].fromMonth == 61
    assert result.monthlyPayments[1].isVariable is True
    assert result.monthlyPayments[1].payment == pytest.approx(expected_recast_payment, abs=0.05)
    assert first_variable_month.scheduledPayment == pytest.approx(expected_recast_payment, abs=0.05)

    # Payment actually changes at the boundary (rates differ meaningfully here).
    assert first_variable_month.scheduledPayment != pytest.approx(last_fixed_month.scheduledPayment, abs=0.5)

    # Never re-fixes: stays on the variable rate for the rest of the term.
    assert all(e.ratePct == 7.25 for e in result.schedule[60:])


def test_never_enters_a_variable_period_if_fixed_term_months_equals_total_term_months():
    result = calculate_mortgage(base_inputs({"fixedTermMonths": 300, "variableRateAnnualPct": 99}))
    assert len(result.monthlyPayments) == 1
    assert result.monthlyPayments[0].isVariable is False
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


def test_rejects_a_non_positive_or_non_integer_savings_payout_interval():
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"savingsPayoutIntervalMonths": 0}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"savingsPayoutIntervalMonths": -1}))
    with pytest.raises(MortgageValidationError):
        calculate_mortgage(base_inputs({"savingsPayoutIntervalMonths": 1.5}))
    calculate_mortgage(base_inputs({"savingsPayoutIntervalMonths": 3}))
    calculate_mortgage(base_inputs({"savingsPayoutIntervalMonths": 6}))


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
                "savingsPayoutIntervalMonths": 12,
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


# calculateMortgage — hybrid rate-after-fixed-term mode


def hybrid_inputs(overrides: dict | None = None) -> MortgageInputs:
    data = {
        "totalTermMonths": 300,
        "fixedTermMonths": 24,
        "variableRateAnnualPct": 7.25,
        "rateAfterFixedTermMode": "hybrid",
        "remortgageGapMonths": 2,
    }
    if overrides:
        data.update(overrides)
    return base_inputs(data)


def test_hybrid_keeps_cycling_just_like_remortgage_to_new_fixed_when_it_would_never_clear_on_variable():
    # No overpayment pool at all (base_inputs' explicit zero pool) against a
    # 300-month term with 24-month fixed deals — nowhere near clearing
    # within a single 24-month lookahead window this early in the loan, so
    # hybrid should behave identically to plain remortgageToNewFixed cycling
    # (checked over a prefix well clear of the final ~24 months, where the
    # remaining term itself eventually drops inside the lookahead window and
    # both modes would legitimately start to diverge from an ordinary
    # remortgage schedule anyway — see the payoff-guarantee test below).
    hybrid_result = calculate_mortgage(hybrid_inputs())
    cycling_result = calculate_mortgage(cycling_inputs())
    prefix = 100
    assert [e.ratePct for e in hybrid_result.schedule[:prefix]] == [
        e.ratePct for e in cycling_result.schedule[:prefix]
    ]
    assert [e.isFixedPeriodBoundary for e in hybrid_result.schedule[:prefix]] == [
        e.isFixedPeriodBoundary for e in cycling_result.schedule[:prefix]
    ]
    assert hybrid_result.payoffMonth == cycling_result.payoffMonth == 300


def test_hybrid_commits_to_variable_once_the_remaining_term_is_short_enough_to_guarantee_payoff():
    # totalTermMonths=36 with a 24-month fixed deal leaves only 12 months
    # after the first fixed period ends — inside the fixedTermMonths (24)
    # lookahead window, so the loan is guaranteed to clear by its own final
    # month regardless of overpayments (the engine always forces full
    # payoff on the real final month). Hybrid should recognise this and
    # stay on the variable rate rather than pointlessly re-fixing for the
    # last few months the way remortgageToNewFixed would.
    hybrid_result = calculate_mortgage(hybrid_inputs({"totalTermMonths": 36}))
    cycling_result = calculate_mortgage(cycling_inputs({"totalTermMonths": 36}))

    assert len(hybrid_result.schedule) == 36
    assert all(e.ratePct == 5 for e in hybrid_result.schedule[0:24])
    assert all(e.ratePct == 7.25 for e in hybrid_result.schedule[24:])
    assert hybrid_result.schedule[23].isFixedPeriodBoundary is True  # month 24: the one and only boundary
    assert all(not e.isFixedPeriodBoundary for e in hybrid_result.schedule[24:])

    # Contrast: plain remortgageToNewFixed re-fixes at month 27 (the 26-month
    # cycle wraps back to a new fixed deal) even though only 36 months exist
    # in total — hybrid's schedule genuinely diverges from it here.
    assert cycling_result.schedule[26].ratePct == 5  # month 27: fixed again
    assert hybrid_result.schedule[26].ratePct == 7.25  # hybrid: still variable


def test_hybrid_payout_is_immediate_at_commit_then_periodic_after():
    result = calculate_mortgage(
        hybrid_inputs(
            {
                "totalTermMonths": 36,
                "propertyValue": 250_000,
                "deposit": 200_000,  # principal 50,000 — small relative to the pool below
                "currentRent": 1800,  # comfortably above the ~1,500/month scheduled payment
                "bankedSavingsDestination": "lumpSumEachCycle",
                "monthlyOverpaymentAmountMode": "none",
                "savingsPayoutIntervalMonths": 3,
            }
        )
    )
    # No payout during the fixed period itself.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[0:24])
    # Immediate payout the month hybrid commits (month 25) — same shape as
    # stayOnVariable's "first payout the month the fixed term ends", just
    # referenced from the commit boundary instead.
    assert result.schedule[24].lumpSumPaid > 0
    # Not again until a full interval (3 months) later.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[25:27])
    assert result.schedule[27].lumpSumPaid > 0  # month 28


def test_hybrid_never_reverts_to_fixed_after_committing_even_if_the_cycle_length_would_otherwise_wrap_back_around():
    # Regression guard for the cycle_length modulo: with a 0-month gap the
    # "new fixed deal" and "gap start" triggers land on the same
    # position_in_cycle value the ordinary cycling math uses, which is
    # exactly the case most likely to let a spurious recast slip through
    # once hybrid has committed.
    result = calculate_mortgage(hybrid_inputs({"totalTermMonths": 36, "remortgageGapMonths": 0}))
    assert all(e.ratePct == 5 for e in result.schedule[0:24])
    assert all(e.ratePct == 7.25 for e in result.schedule[24:])


def test_calculate_echoes_rate_after_fixed_term_mode_in_the_result():
    result = calculate_mortgage(hybrid_inputs())
    assert result.rateAfterFixedTermMode == "hybrid"


def test_hybrid_lookahead_inherits_the_real_mid_year_allowance_state_instead_of_resetting_fresh():
    # Regression: an earlier version of _would_clear_within_window_on_variable
    # reset allowance_used_this_year/auto_target_used_this_year to 0 at the
    # start of every lookahead, rather than inheriting the boundary month's
    # real mid-year state — an Opus math-review pass found this could bias
    # the commit decision in either direction (optimistic when real usage
    # this year was already high, pessimistic when the allowance basis is
    # 'outstanding' and the limit itself has since drifted). Directly proves
    # the carried-in state is what actually drives the 'auto' pacing: with
    # this year's allowance already almost fully used (auto_target_used_this_year
    # close to the target), a modest pool can't finish pacing fast enough to
    # clear within the window; with nothing used yet, it can.
    from app.engine.mortgage import _would_clear_within_window_on_variable
    from app.engine.types import MortgageConfig

    config = MortgageConfig(
        annualOverpaymentAllowancePct=10,
        allowanceBasis="outstanding",
        ercRateOnExcessPct=3,
        ercAppliesDuringFixedTermOnly=True,
        arrangementFee=0,
        arrangementFeeAddedToLoan=False,
    )
    kwargs = dict(
        balance_pence=200_000,  # £2,000
        principal_pence=200_000,
        savings_pot_pence=0,
        start_month=2,  # mid-year: month 2 of the allowance year, 10 months left in it
        remaining_total_term_months=300,
        window_months=10,
        variable_monthly_rate=7.25 / 100 / 12,
        config=config,
        overpayment_mode="reduceTerm",
        overpayment_amount_mode="auto",
        fixed_monthly_overpayment_pence=0,
        target_utilization_pct=100,
        monthly_budget_pool_pence=180_000,  # £1,800/month pool, well above the tiny base payment
        banked_destination="keepAsSavings",
        savings_payout_interval_months=6,
        allowance_limit_this_year=250_000,  # £2,500 target for the year
    )

    clears_when_nothing_used_yet = _would_clear_within_window_on_variable(
        **kwargs, allowance_used_this_year=0, auto_target_used_this_year=0
    )
    clears_when_almost_fully_used_already = _would_clear_within_window_on_variable(
        **kwargs, allowance_used_this_year=225_000, auto_target_used_this_year=225_000
    )
    assert clears_when_nothing_used_yet is True
    assert clears_when_almost_fully_used_already is False


def test_hybrid_commits_via_genuine_overpayment_driven_payoff_not_just_the_forced_final_month_rule():
    # Unlike the totalTermMonths=36 tests above (where remaining_total_term_months
    # ends up <= the fixedTermMonths lookahead window, so the engine's
    # "always fully pay off the literal final month" rule trivially decides
    # the check on its own), this uses a 120-month term — the remaining term
    # at the first boundary (96 months) is nowhere near the 24-month window,
    # so a "yes" here can only come from _would_clear_within_window_on_variable's
    # actual per-month projection (recast payment + banked-pool payouts),
    # genuinely exercising that logic rather than the trivial branch.
    inputs = {
        "totalTermMonths": 120,
        "propertyValue": 300_000,
        "deposit": 250_000,  # principal 50,000
        "currentRent": 1500,  # pool comfortably above the recast payment
        "bankedSavingsDestination": "lumpSumEachCycle",
        "monthlyOverpaymentAmountMode": "none",
        "savingsPayoutIntervalMonths": 6,
    }
    hybrid_result = calculate_mortgage(hybrid_inputs(inputs))
    cycling_result = calculate_mortgage(cycling_inputs(inputs))

    # Doesn't clear immediately on commit (this is a multi-payout payoff, not
    # a one-shot one) — proves the periodic-payout path is actually doing
    # the work, not just the immediate first payout alone.
    assert hybrid_result.payoffMonth > 30
    assert all(e.ratePct == 5 for e in hybrid_result.schedule[0:24])
    assert all(e.ratePct == 7.25 for e in hybrid_result.schedule[24:])
    assert [e.month for e in hybrid_result.schedule if e.isFixedPeriodBoundary] == [24]

    # Contrast: plain remortgageToNewFixed re-fixes at month 27 and takes
    # longer overall, since it keeps giving back the ERC-free variable
    # window to a new fixed deal instead of ever committing.
    assert cycling_result.schedule[26].ratePct == 5  # month 27: fixed again
    assert hybrid_result.payoffMonth < cycling_result.payoffMonth


def test_hybrid_does_not_commit_at_an_early_boundary_but_does_at_a_later_one_once_the_balance_is_low_enough():
    # Same shape as the genuine-payoff test above, but with a smaller pool
    # relative to the remaining term at month 24 (not enough to clear within
    # a single 24-month window yet) — hybrid should keep cycling past the
    # first boundary, then commit once a later boundary's shorter remaining
    # balance brings it within reach. Proves the check re-runs at every
    # boundary independently rather than only ever getting one shot.
    inputs = {
        "totalTermMonths": 120,
        "propertyValue": 300_000,
        "deposit": 200_000,  # principal 100,000 — too big to clear from the first boundary
        "currentRent": 1500,
        "bankedSavingsDestination": "lumpSumEachCycle",
        "monthlyOverpaymentAmountMode": "none",
        "savingsPayoutIntervalMonths": 6,
    }
    result = calculate_mortgage(hybrid_inputs(inputs))
    # Still cycling: re-fixes at month 27 (26-month cycle), unlike the
    # genuine-payoff test above where hybrid commits immediately at month 24.
    assert result.schedule[26].ratePct == 5  # month 27: fixed again
    boundaries = [e.month for e in result.schedule if e.isFixedPeriodBoundary]
    assert len(boundaries) > 1, "should have kept cycling past the first boundary"
    # Eventually commits at some later boundary and never re-fixes after it.
    last_boundary = boundaries[-1]
    assert all(e.ratePct == 7.25 for e in result.schedule[last_boundary:])


# calculateMortgage — savings payout, staying on the variable rate (periodic, savingsPayoutIntervalMonths)


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


def test_pays_out_the_banked_pot_the_month_the_fixed_term_ends_then_every_savings_payout_interval_months_after_that():
    # Regression: the rate-cycling refactor accidentally coupled this mechanism
    # entirely to remortgaging into a new fixed deal, so it silently stopped
    # firing at all under rateAfterFixedTermMode: 'stayOnVariable'. Periodic
    # payouts must work regardless of what the rate does afterwards.
    result = calculate_mortgage(payout_inputs({"savingsPayoutIntervalMonths": 12}))
    # No payout during the fixed term itself.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[0:24])
    # First payout the month the fixed term ends (month 25), not delayed by a
    # full interval.
    assert result.schedule[24].lumpSumPaid > 0
    # Not again until a full interval (12 months) has passed.
    assert all(e.lumpSumPaid == 0 for e in result.schedule[25:36])
    # Repeats every 12 months after that (month 37).
    assert result.schedule[36].lumpSumPaid > 0


def test_supports_short_intervals_3_months_and_6_months():
    quarterly = calculate_mortgage(payout_inputs({"savingsPayoutIntervalMonths": 3}))
    # First payout month 25, next 3 months later at month 28.
    assert quarterly.schedule[24].lumpSumPaid > 0
    assert all(e.lumpSumPaid == 0 for e in quarterly.schedule[25:27])
    assert quarterly.schedule[27].lumpSumPaid > 0  # month 28

    semi_annual = calculate_mortgage(payout_inputs({"savingsPayoutIntervalMonths": 6}))
    assert semi_annual.schedule[24].lumpSumPaid > 0
    assert all(e.lumpSumPaid == 0 for e in semi_annual.schedule[25:30])
    assert semi_annual.schedule[30].lumpSumPaid > 0  # month 31


def test_a_shorter_payout_interval_pays_out_more_often_than_a_longer_one():
    frequent = calculate_mortgage(payout_inputs({"savingsPayoutIntervalMonths": 6}))
    infrequent = calculate_mortgage(payout_inputs({"savingsPayoutIntervalMonths": 24}))

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
            "savingsPayoutIntervalMonths": 12,
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


def test_pays_out_the_month_immediately_after_each_fixed_deal_ends_repeating_every_cycle_ignoring_savings_payout_interval_months_entirely():
    # mode 'none' (no competing recurring overpayment) isolates the payout
    # mechanism's timing: with cycling active, a payout should land right after
    # each remortgage point regardless of any calendar interval set.
    result = calculate_mortgage(cycling_payout_inputs({"savingsPayoutIntervalMonths": 60}))
    # Cycle boundaries at months 24 and 50 (26-month cycle: 24 fixed + 2 gap) —
    # payouts land the month immediately after each one, not tied to the
    # (deliberately huge, 60-month) interval above.
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
    result = calculate_mortgage(MortgageInputs(propertyValue=250_000, includeSchedule=True))
    # deriveDepositFromSavings is on by default, so deposit resolves to
    # depositSavings minus SDLT (not the flat `deposit` default) — see
    # resolve_mortgage_inputs().
    assert result.principal == 250_000 - DERIVED_DEPOSIT_250K
    # Every other field defaults too, including the rent+savings pool and
    # 'auto' overpayment mode — real overpayments pay this off well before
    # the default 300-month term.
    assert len(result.schedule) == 61


def test_calculate_only_fills_defaults_for_fields_left_unset():
    explicit = calculate_mortgage(
        MortgageInputs(propertyValue=250_000, deposit=50_000, fixedRateAnnualPct=5, includeSchedule=True)
    )
    defaulted_deposit = calculate_mortgage(MortgageInputs(propertyValue=250_000, fixedRateAnnualPct=5))
    assert explicit.principal == 200_000
    # Caller-supplied fields are untouched by default-filling.
    assert explicit.schedule[0].ratePct == 5
    assert defaulted_deposit.principal == 250_000 - DERIVED_DEPOSIT_250K


def test_calculate_uses_flat_deposit_default_when_derive_from_savings_is_off():
    defaults = _SEED.model_copy(update={"deriveDepositFromSavings": False})
    result = calculate_mortgage(MortgageInputs(propertyValue=250_000), defaults=defaults)
    assert result.principal == 250_000 - DEFAULT_DEPOSIT


def test_calculate_derives_deposit_with_a_nonzero_sdlt_deduction():
    # £600,000 is above the £500k FTB-relief ceiling, so standard (non-FTB)
    # bands apply in full: 0% to £125k, 2% to £250k, 5% to £600k =
    # 0 + 2,500 + 17,500 = £20,000 — a real, nonzero deduction, unlike the
    # £250,000/FTB case used elsewhere in this file (SDLT = £0 there, which
    # can't distinguish "subtracted correctly" from "subtraction dropped
    # entirely").
    property_value = 600_000
    sdlt = calculate_sdlt(property_value, _SEED.isFirstTimeBuyer)
    assert sdlt.totalTax == 20_000
    expected_deposit = _SEED.depositSavings - sdlt.totalTax

    result = calculate_mortgage(MortgageInputs(propertyValue=property_value))
    assert result.principal == property_value - expected_deposit


def test_calculate_with_all_fields_given_ignores_defaults_entirely():
    inputs = base_inputs()
    result = calculate_mortgage(inputs)
    # base_inputs() supplies every field explicitly; equivalent to calling
    # resolve_mortgage_inputs() as a no-op.
    assert result.principal == 200_000
    assert len(result.schedule) == 300

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

OverpaymentMode = Literal["reduceTerm", "reducePayment"]
AllowanceBasis = Literal["outstanding", "original"]
MonthlyOverpaymentAmountMode = Literal["none", "fixed", "auto"]
BankedSavingsDestination = Literal["lumpSumEachCycle", "keepAsSavings"]
RateAfterFixedTermMode = Literal["remortgageToNewFixed", "stayOnVariable"]


class LumpSumOverpayment(BaseModel):
    # float, not int: mirrors TS's `number` type, which doesn't enforce
    # integer-ness at the type boundary either. validate_inputs() is the
    # single source of truth for the "must be a whole number" check on both
    # sides — Pydantic must not pre-empt it with its own stricter coercion,
    # or MortgageValidationError never gets raised for a fractional month.
    atMonth: float
    amount: float


class MortgageConfig(BaseModel):
    annualOverpaymentAllowancePct: float
    allowanceBasis: AllowanceBasis
    ercRateOnExcessPct: float
    ercAppliesDuringFixedTermOnly: bool
    arrangementFee: float
    arrangementFeeAddedToLoan: bool


class MortgageConfigOverrides(BaseModel):
    annualOverpaymentAllowancePct: Optional[float] = None
    allowanceBasis: Optional[AllowanceBasis] = None
    ercRateOnExcessPct: Optional[float] = None
    ercAppliesDuringFixedTermOnly: Optional[bool] = None
    arrangementFee: Optional[float] = None
    arrangementFeeAddedToLoan: Optional[bool] = None


class MortgageDefaults(BaseModel):
    """The single source of truth for every default value used to fill in an
    unspecified field — for both a partial /calculate request (deposit,
    rate, term fields; see resolve_mortgage_inputs()) and the frontend's
    form pre-fill (GET /api/v1/defaults). Runtime values are stored in the
    defaults_config DB table (admin-editable); defaults.json is only the
    seed/reset target — see app.engine.config.load_seed_defaults()."""

    config: MortgageConfig
    variableRateAnnualPct: float
    remortgageGapMonths: float
    savingsPayoutIntervalMonths: float
    fixedRateAnnualPct: float
    fixedTermMonths: float
    totalTermMonths: float
    deposit: float
    # depositSavings/isFirstTimeBuyer/deriveDepositFromSavings feed the frontend's
    # initial pre-fill (buildDefaultFormState in src/types/formState.ts) *and*
    # resolve_mortgage_inputs(): when deriveDepositFromSavings is true and a caller
    # omits `deposit` (e.g. a partial /calculate with only propertyValue), the
    # server derives it as depositSavings minus SDLT(propertyValue,
    # isFirstTimeBuyer) via the engine's own sdlt.py, mirroring the frontend's
    # updateDepositDriver() formula exactly — when false, `deposit` above is used
    # as a flat fallback instead, same as before.
    depositSavings: float
    isFirstTimeBuyer: bool
    deriveDepositFromSavings: bool
    overpaymentMode: OverpaymentMode
    currentRent: float
    monthlySavings: float
    serviceCharge: float
    monthlyOverpaymentAmountMode: MonthlyOverpaymentAmountMode
    fixedMonthlyOverpayment: float
    targetAllowanceUtilizationPct: float
    bankedSavingsDestination: BankedSavingsDestination
    rateAfterFixedTermMode: RateAfterFixedTermMode
    # None when loaded from defaults.json (load_seed_defaults()) rather than
    # the DB — the seed file itself was never "updated".
    updatedAt: Optional[str] = None


class MortgageInputs(BaseModel):
    propertyValue: float
    # deposit/rate/term fields are optional so callers who only know
    # propertyValue (e.g. a quick affordability estimate from a listing
    # price) can omit them — resolve_mortgage_inputs() fills sensible
    # defaults before validation/calculation ever see a None here.
    deposit: Optional[float] = None
    fixedRateAnnualPct: Optional[float] = None
    # float, not int: see LumpSumOverpayment.atMonth comment above — same
    # reasoning applies to every "whole number of months" field here.
    fixedTermMonths: Optional[float] = None
    variableRateAnnualPct: Optional[float] = None
    totalTermMonths: Optional[float] = None

    lumpSums: Optional[list[LumpSumOverpayment]] = None
    overpaymentMode: Optional[OverpaymentMode] = None

    currentRent: Optional[float] = None
    monthlySavings: Optional[float] = None
    serviceCharge: Optional[float] = None

    monthlyOverpaymentAmountMode: Optional[MonthlyOverpaymentAmountMode] = None
    fixedMonthlyOverpayment: Optional[float] = None
    targetAllowanceUtilizationPct: Optional[float] = None

    bankedSavingsDestination: Optional[BankedSavingsDestination] = None
    savingsPayoutIntervalMonths: Optional[float] = None
    rateAfterFixedTermMode: Optional[RateAfterFixedTermMode] = None
    remortgageGapMonths: Optional[float] = None

    config: Optional[MortgageConfigOverrides] = None


class MonthlyScheduleEntry(BaseModel):
    month: int
    ratePct: float
    openingBalance: float
    scheduledPayment: float
    interestPaid: float
    principalPaid: float
    overpaymentPaid: float
    lumpSumPaid: float
    savingsAddedThisMonth: float
    savingsPotBalance: float
    isFixedPeriodBoundary: bool
    ercCharged: float
    closingBalance: float


class MortgageResult(BaseModel):
    schedule: list[MonthlyScheduleEntry]
    principal: float
    initialMonthlyPayment: float
    variablePeriodMonthlyPayment: float
    payoffMonth: int
    totalInterestPaid: float
    totalPrincipalPaid: float
    totalOverpaid: float
    totalErcPaid: float
    totalRepaid: float
    monthsSavedVsOriginalTerm: int
    unallocatedSavingsPot: float
    warnings: list[str]


class ComparisonResult(BaseModel):
    withOverpayments: MortgageResult
    withoutOverpayments: MortgageResult
    interestSaved: float
    monthsSaved: int


class MortgageValidationError(Exception):
    def __init__(self, issues: list[str]) -> None:
        self.issues = issues
        super().__init__(f"Invalid mortgage inputs: {'; '.join(issues)}")

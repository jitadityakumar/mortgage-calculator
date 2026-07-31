from app.engine.sdlt import calculate_sdlt


# calculateSdlt — standard rates

def test_computes_tax_across_multiple_bands_correctly():
    # £295,000: 0% on first 125k, 2% on next 125k (=2500), 5% on remaining 45k (=2250)
    result = calculate_sdlt(295_000, False)
    assert result.totalTax == 4_750
    sum_of_breakdown = sum(b.tax for b in result.breakdown)
    assert sum_of_breakdown == result.totalTax


def test_charges_nothing_on_a_property_at_or_below_the_zero_rate_threshold():
    result = calculate_sdlt(125_000, False)
    assert result.totalTax == 0


def test_applies_the_top_band_above_1_5m():
    # 125k*0 + 125k*2%(2500) + 675k*5%(33750) + 575k*10%(57500) + 100k*12%(12000) = 105,750
    result = calculate_sdlt(1_600_000, False)
    assert result.totalTax == 105_750


# calculateSdlt — first-time buyer relief

def test_charges_nothing_when_fully_within_the_ftb_zero_rate_band():
    result = calculate_sdlt(295_000, True)
    assert result.totalTax == 0


def test_charges_5_pct_on_the_portion_between_300000_and_500000():
    result = calculate_sdlt(350_000, True)
    assert result.totalTax == 2_500


def test_falls_back_to_standard_rates_no_relief_above_the_500000_threshold():
    ftb = calculate_sdlt(600_000, True)
    non_ftb = calculate_sdlt(600_000, False)
    assert ftb.totalTax == non_ftb.totalTax
    assert ftb.totalTax == 20_000


# calculateSdlt — edge cases

def test_returns_zero_tax_and_an_empty_breakdown_for_a_non_positive_property_value():
    result_zero = calculate_sdlt(0, False)
    assert result_zero.totalTax == 0
    assert result_zero.breakdown == []

    result_negative = calculate_sdlt(-1, False)
    assert result_negative.totalTax == 0
    assert result_negative.breakdown == []

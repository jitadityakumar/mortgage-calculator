import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { setDefaultsShouldFail, setMockDefaultsOverride } from './test/mockApi';

/** Renders the app and waits for the pre-fetched defaults (GET
 * /api/v1/defaults) to resolve and the form to mount, so subsequent
 * synchronous screen.getByText/getByRole calls in a test don't race the
 * initial async load. */
async function renderApp() {
  render(<App />);
  await screen.findByText('Deposit');
}

function getInputForLabel(labelText: string): HTMLInputElement {
  return screen.getByText(labelText).closest('label')!.querySelector('input')!;
}

function getSelectForLabel(labelText: string): HTMLSelectElement {
  return screen.getByText(labelText).closest('label')!.querySelector('select')!;
}

/** Turns off both overpayment mechanisms (recurring amount + lump-sum cycling),
 * leaving only whatever the test adds on top (e.g. a manual lump sum). */
async function turnOffAllOverpayments(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("None — don't overpay monthly (savings can still fund a lump sum below)"));
  await user.click(screen.getByText('Just keep as savings (no lump sum)'));
}

describe('App', () => {
  it('shows a loading state while defaults are being fetched, then renders the form', async () => {
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Deposit')).not.toBeInTheDocument();

    await screen.findByText('Deposit');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows an error instead of the form when fetching defaults fails', async () => {
    setDefaultsShouldFail(true);
    render(<App />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('Could not reach the calculation service. Please refresh to try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Deposit')).not.toBeInTheDocument();
  });

  it('renders default results for the pre-filled inputs', async () => {
    await renderApp();
    expect(await screen.findByText('Monthly payment (from the start)')).toBeInTheDocument();
    expect(screen.getAllByText('Time to pay off').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total interest paid').length).toBeGreaterThan(0);
  });

  it('shows validation errors instead of results when the deposit exceeds the property value', async () => {
    const user = userEvent.setup();
    await renderApp();

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '999999');

    expect(await screen.findByText('Check your inputs')).toBeInTheDocument();
    expect(screen.queryByText('Monthly payment (from the start)')).not.toBeInTheDocument();
  });

  it('the default auto overpayment mode produces a comparison out of the box', async () => {
    await renderApp();
    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();
  });

  it('turning off both overpayment mechanisms removes the comparison', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();

    await turnOffAllOverpayments(user);
    await waitFor(() => expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument());
  });

  it('a fixed monthly overpayment alone triggers the comparison', async () => {
    const user = userEvent.setup();
    await renderApp();
    await turnOffAllOverpayments(user);
    await waitFor(() => expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument());

    await user.click(screen.getByText('Fixed amount'));
    const fixedInput = getInputForLabel('Fixed monthly overpayment');
    await user.clear(fixedInput);
    await user.type(fixedInput, '200');

    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();
  });

  it('expands the Stamp Duty section and shows a tax figure', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText(/Stamp Duty Land Tax/));
    expect(await screen.findByText('Stamp Duty Land Tax')).toBeInTheDocument();
    expect(screen.getByText('Cash needed at completion (deposit + SDLT)')).toBeInTheDocument();
  });

  it('toggles the Advanced assumptions section open and closed', async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(screen.queryByText('Penalty-free overpayment allowance')).not.toBeInTheDocument();

    const advancedButton = screen.getByRole('button', { name: /Advanced assumptions/ });
    await user.click(advancedButton);
    expect(screen.getByText('Penalty-free overpayment allowance')).toBeInTheDocument();

    await user.click(advancedButton);
    expect(screen.queryByText('Penalty-free overpayment allowance')).not.toBeInTheDocument();
  });

  it('adding a lump sum alone triggers the overpayment comparison, and removing it clears it again', async () => {
    const user = userEvent.setup();
    await renderApp();
    await turnOffAllOverpayments(user);
    await waitFor(() => expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument());

    await user.click(screen.getByText('+ Add lump sum'));
    const monthInput = getInputForLabel('Month #');
    const amountInput = getInputForLabel('Amount');
    await user.type(monthInput, '12');
    await user.type(amountInput, '5000');

    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove lump sum' }));
    expect(screen.queryByLabelText('Month #')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument());
  });

  it('shows the balance chart comparison line even when reducePayment mode keeps the schedule length unchanged', async () => {
    // reducePayment mode with a one-off lump sum (no recurring overpayment) pays
    // off at the same month as the no-overpayment baseline — same schedule
    // length, very different balances throughout. The chart must key off
    // whether a comparison schedule was passed, not off length inequality.
    const user = userEvent.setup();
    await renderApp();
    await turnOffAllOverpayments(user);

    await user.selectOptions(getSelectForLabel('When you overpay, it should...'), 'reducePayment');
    await user.click(screen.getByText('+ Add lump sum'));
    await user.type(getInputForLabel('Month #'), '12');
    await user.type(getInputForLabel('Amount'), '5000');

    expect(await screen.findByText('With overpayments')).toBeInTheDocument();
    expect(screen.getByText('Without overpayments')).toBeInTheDocument();
  });

  it('shows the effective-savings hint whenever the pool is in use, hidden once both mechanisms are off', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(await screen.findByText(/leaving about/)).toBeInTheDocument();

    await turnOffAllOverpayments(user);
    expect(screen.queryByText(/leaving about/)).not.toBeInTheDocument();
  });

  it('the target allowance % field only appears in auto mode', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(screen.getByText('Use up to this % of my penalty-free allowance')).toBeInTheDocument();

    await user.click(screen.getByText('Fixed amount'));
    expect(screen.queryByText('Use up to this % of my penalty-free allowance')).not.toBeInTheDocument();

    await user.click(screen.getByText("None — don't overpay monthly (savings can still fund a lump sum below)"));
    expect(screen.queryByText('Use up to this % of my penalty-free allowance')).not.toBeInTheDocument();
  });

  it('the remortgage gap field only appears when remortgaging into a new fixed deal', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(screen.getByText('Time to arrange the next fixed deal')).toBeInTheDocument();

    await user.click(screen.getByText('Move onto the variable rate and stay there'));
    expect(screen.queryByText('Time to arrange the next fixed deal')).not.toBeInTheDocument();
  });

  it('the savings payout interval field only appears when staying on the variable rate; cycling shows an automatic-payout note instead', async () => {
    const user = userEvent.setup();
    await renderApp();
    // App default is 'remortgageToNewFixed', where payout timing follows the
    // remortgage cycle automatically — the calendar interval field doesn't apply.
    expect(screen.queryByText('Pay out banked savings every')).not.toBeInTheDocument();
    expect(screen.getByText(/Banked savings pay out automatically each time you remortgage/)).toBeInTheDocument();

    await user.click(screen.getByText('Move onto the variable rate and stay there'));
    expect(screen.getByText('Pay out banked savings every')).toBeInTheDocument();
    expect(screen.queryByText(/Banked savings pay out automatically each time you remortgage/)).not.toBeInTheDocument();

    await user.click(screen.getByText('Just keep as savings (no lump sum)'));
    expect(screen.queryByText('Pay out banked savings every')).not.toBeInTheDocument();
  });

  it('the pool-in-use hints stay visible for a lump-sum-cycle strategy even while staying on the variable rate', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByText("None — don't overpay monthly (savings can still fund a lump sum below)"));
    expect(await screen.findByText(/leaving about/)).toBeInTheDocument();

    await user.click(screen.getByText('Move onto the variable rate and stay there'));
    // Periodic payouts still use the pool, so the hints must stay visible — this
    // combo is no longer a no-op.
    expect(screen.getByText(/leaving about/)).toBeInTheDocument();
    expect(screen.getByText(/Maximizing overpayments every month/)).toBeInTheDocument();
  });

  it('highlights fixed-period-boundary rows in the amortization table', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    await user.click(screen.getByText(/Full amortization schedule/));
    expect(await screen.findByText('Rows shaded and marked ↷ are the last month of a fixed-rate deal.')).toBeInTheDocument();
  });

  it('saves a calculation and it appears in the saved list', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    expect(screen.getByText('None saved yet.')).toBeInTheDocument();

    await user.type(getInputForLabel('Name'), 'My base case');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/My base case/)).toBeInTheDocument();
    expect(screen.queryByText('None saved yet.')).not.toBeInTheDocument();
  });

  it('loading a saved calculation populates the form', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '120000');
    await user.type(getInputForLabel('Name'), 'Higher deposit');
    // Save is disabled while the debounced recalculation for the new
    // deposit is still in flight — wait for it to settle before saving, or
    // the click would be a no-op.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Higher deposit/);

    await user.clear(depositInput);
    await user.type(depositInput, '10000');
    await waitFor(() => expect(depositInput.value).toBe('10000'));

    await user.click(screen.getByText(/Higher deposit/));
    await waitFor(() => expect(depositInput.value).toBe('120000'));
  });

  it('loading a saved calculation with a different property value does not clobber its saved deposit', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    const propertyValueInput = getInputForLabel('Property value');
    const depositInput = getInputForLabel('Deposit');

    // Changing property value auto-fills deposit (savings minus SDLT); then
    // override deposit manually before saving, so the saved deposit is a
    // deliberately-chosen value, not whatever the auto-fill computed.
    await user.clear(propertyValueInput);
    await user.type(propertyValueInput, '600000');
    await user.clear(depositInput);
    await user.type(depositInput, '75000');
    await user.type(getInputForLabel('Name'), 'Pricier place');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Pricier place/);

    // Change property value back down — the driving field the auto-fill
    // watches — so loading the save afterward exercises the exact path
    // where a naive "skip the next auto-fill" flag could misfire.
    await user.clear(propertyValueInput);
    await user.type(propertyValueInput, '450000');
    await waitFor(() => expect(propertyValueInput.value).toBe('450000'));

    await user.click(screen.getByText(/Pricier place/));
    await waitFor(() => expect(propertyValueInput.value).toBe('600000'));
    expect(depositInput.value).toBe('75000');
  });

  it('does not auto-fill deposit from savings when the admin default turns it off', async () => {
    setMockDefaultsOverride({ deriveDepositFromSavings: false });
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    const depositInput = getInputForLabel('Deposit');
    // MOCK_DEFAULTS.deposit is 80_000 — with derivation off, the initial
    // form should show that flat default, not depositSavings minus SDLT.
    expect(depositInput.value).toBe('80000');

    const propertyValueInput = getInputForLabel('Property value');
    await user.clear(propertyValueInput);
    await user.type(propertyValueInput, '600000');
    await waitFor(() => expect(propertyValueInput.value).toBe('600000'));

    // Deposit must stay untouched by the driving-field change.
    expect(depositInput.value).toBe('80000');
  });

  it('deleting a saved calculation removes it from the list', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    await user.type(getInputForLabel('Name'), 'To be deleted');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/To be deleted/);

    await user.click(screen.getByRole('button', { name: 'Delete To be deleted' }));
    await waitFor(() => expect(screen.queryByText(/To be deleted/)).not.toBeInTheDocument());
    expect(screen.getByText('None saved yet.')).toBeInTheDocument();
  });

  it('disables saving while validation issues are present', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText(/You'd save/);

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '999999');
    await screen.findByText('Check your inputs');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

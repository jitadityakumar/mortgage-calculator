import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

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
  it('renders default results for the pre-filled inputs', async () => {
    render(<App />);
    expect(await screen.findByText('Monthly payment (fixed period)')).toBeInTheDocument();
    expect(screen.getAllByText('Time to pay off').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total interest paid').length).toBeGreaterThan(0);
  });

  it('shows validation errors instead of results when the deposit exceeds the property value', async () => {
    const user = userEvent.setup();
    render(<App />);

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '999999');

    expect(await screen.findByText('Check your inputs')).toBeInTheDocument();
    expect(screen.queryByText('Monthly payment (fixed period)')).not.toBeInTheDocument();
  });

  it('the default auto overpayment mode produces a comparison out of the box', async () => {
    render(<App />);
    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();
  });

  it('turning off both overpayment mechanisms removes the comparison', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();

    await turnOffAllOverpayments(user);
    expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument();
  });

  it('a fixed monthly overpayment alone triggers the comparison', async () => {
    const user = userEvent.setup();
    render(<App />);
    await turnOffAllOverpayments(user);
    expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument();

    await user.click(screen.getByText('Fixed amount'));
    const fixedInput = getInputForLabel('Fixed monthly overpayment');
    await user.clear(fixedInput);
    await user.type(fixedInput, '200');

    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();
  });

  it('expands the Stamp Duty section and shows a tax figure', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText(/Stamp Duty Land Tax/));
    expect(await screen.findByText('Stamp Duty Land Tax')).toBeInTheDocument();
    expect(screen.getByText('Cash needed at completion (deposit + SDLT)')).toBeInTheDocument();
  });

  it('toggles the Advanced assumptions section open and closed', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByText('Penalty-free overpayment allowance')).not.toBeInTheDocument();

    const advancedButton = screen.getByRole('button', { name: /Advanced assumptions/ });
    await user.click(advancedButton);
    expect(screen.getByText('Penalty-free overpayment allowance')).toBeInTheDocument();

    await user.click(advancedButton);
    expect(screen.queryByText('Penalty-free overpayment allowance')).not.toBeInTheDocument();
  });

  it('adding a lump sum alone triggers the overpayment comparison, and removing it clears it again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await turnOffAllOverpayments(user);
    expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument();

    await user.click(screen.getByText('+ Add lump sum'));
    const monthInput = getInputForLabel('Month #');
    const amountInput = getInputForLabel('Amount');
    await user.type(monthInput, '12');
    await user.type(amountInput, '5000');

    expect(await screen.findByText(/You'd save/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove lump sum' }));
    expect(screen.queryByLabelText('Month #')).not.toBeInTheDocument();
    expect(screen.queryByText(/You'd save/)).not.toBeInTheDocument();
  });

  it('shows the balance chart comparison line even when reducePayment mode keeps the schedule length unchanged', async () => {
    // reducePayment mode with a one-off lump sum (no recurring overpayment) pays
    // off at the same month as the no-overpayment baseline — same schedule
    // length, very different balances throughout. The chart must key off
    // whether a comparison schedule was passed, not off length inequality.
    const user = userEvent.setup();
    render(<App />);
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
    render(<App />);
    expect(await screen.findByText(/leaving about/)).toBeInTheDocument();

    await turnOffAllOverpayments(user);
    expect(screen.queryByText(/leaving about/)).not.toBeInTheDocument();
  });

  it('the target allowance % field only appears in auto mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('Use up to this % of my penalty-free allowance')).toBeInTheDocument();

    await user.click(screen.getByText('Fixed amount'));
    expect(screen.queryByText('Use up to this % of my penalty-free allowance')).not.toBeInTheDocument();

    await user.click(screen.getByText("None — don't overpay monthly (savings can still fund a lump sum below)"));
    expect(screen.queryByText('Use up to this % of my penalty-free allowance')).not.toBeInTheDocument();
  });

  it('the remortgage gap field only appears when remortgaging into a new fixed deal', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('Time to arrange the next fixed deal')).toBeInTheDocument();

    await user.click(screen.getByText('Move onto the variable rate and stay there'));
    expect(screen.queryByText('Time to arrange the next fixed deal')).not.toBeInTheDocument();
  });

  it('the savings payout interval field only appears when staying on the variable rate; cycling shows an automatic-payout note instead', async () => {
    const user = userEvent.setup();
    render(<App />);
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
    render(<App />);
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
    render(<App />);
    await screen.findByText(/You'd save/);

    await user.click(screen.getByText(/Full amortization schedule/));
    expect(await screen.findByText('Rows shaded and marked ↷ are the last month of a fixed-rate deal.')).toBeInTheDocument();
  });
});

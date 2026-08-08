import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';
import { setDefaultsPutShouldFail, setDefaultsShouldFail } from '../test/mockApi';

async function renderAdminPage() {
  render(<AdminPage />);
  await screen.findByText('Deposit');
}

function getInputForLabel(labelText: string): HTMLInputElement {
  return screen.getByText(labelText).closest('label')!.querySelector('input')!;
}

describe('AdminPage', () => {
  it('shows a loading state while defaults are being fetched, then renders the form', async () => {
    render(<AdminPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await screen.findByText('Deposit');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(getInputForLabel('Deposit').value).toBe('80000');
    expect(screen.getByText('Never edited — showing the shipped defaults.')).toBeInTheDocument();
  });

  it('shows an error if fetching defaults fails', async () => {
    setDefaultsShouldFail(true);
    render(<AdminPage />);
    await screen.findByText('Something went wrong');
    expect(screen.queryByText('Deposit')).not.toBeInTheDocument();
  });

  it('edits a field and saves, showing success and the new last-updated time', async () => {
    const user = userEvent.setup();
    await renderAdminPage();

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '99000');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(getInputForLabel('Deposit').value).toBe('99000');
    expect(screen.queryByText('Never edited — showing the shipped defaults.')).not.toBeInTheDocument();
  });

  it('shows validation issues from a failed save without crashing the form', async () => {
    const user = userEvent.setup();
    await renderAdminPage();
    setDefaultsPutShouldFail(true);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Default deposit cannot be negative.');
    expect(screen.getByText('Deposit')).toBeInTheDocument();
  });

  it('resets to shipped defaults after confirmation', async () => {
    const user = userEvent.setup();
    await renderAdminPage();

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(getInputForLabel('Deposit').value).toBe('1');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reset to shipped defaults' }));

    await screen.findByText('Reset to shipped defaults.');
    expect(getInputForLabel('Deposit').value).toBe('80000');
    confirmSpy.mockRestore();
  });

  it('edits deposit savings and the two checkboxes, and saves', async () => {
    const user = userEvent.setup();
    await renderAdminPage();

    expect(getInputForLabel('Deposit savings').value).toBe('90000');
    expect(getInputForLabel('First-time buyer by default (affects SDLT, which feeds the deposit auto-fill)').checked).toBe(
      true,
    );
    expect(
      getInputForLabel('Derive deposit from savings (deposit auto-fills as Deposit savings minus SDLT, live as the user types)')
        .checked,
    ).toBe(true);

    const savingsInput = getInputForLabel('Deposit savings');
    await user.clear(savingsInput);
    await user.type(savingsInput, '120000');
    await user.click(
      screen.getByText('First-time buyer by default (affects SDLT, which feeds the deposit auto-fill)'),
    );
    await user.click(
      screen.getByText(
        'Derive deposit from savings (deposit auto-fills as Deposit savings minus SDLT, live as the user types)',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(getInputForLabel('Deposit savings').value).toBe('120000');
    expect(getInputForLabel('First-time buyer by default (affects SDLT, which feeds the deposit auto-fill)').checked).toBe(
      false,
    );
    expect(
      getInputForLabel('Derive deposit from savings (deposit auto-fills as Deposit savings minus SDLT, live as the user types)')
        .checked,
    ).toBe(false);
  });

  it('does not reset when the confirmation is declined', async () => {
    const user = userEvent.setup();
    await renderAdminPage();

    const depositInput = getInputForLabel('Deposit');
    await user.clear(depositInput);
    await user.type(depositInput, '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Reset to shipped defaults' }));

    expect(getInputForLabel('Deposit').value).toBe('1');
    confirmSpy.mockRestore();
  });
});

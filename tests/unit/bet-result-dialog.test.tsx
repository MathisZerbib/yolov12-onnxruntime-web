import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BetResultDialog } from '@/components/bet-result-dialog';

describe('BetResultDialog', () => {
  it('portals a loss result outside the betting panel and closes from Continue', async () => {
    const onContinue = vi.fn();
    render(
      <MemoryRouter>
        <aside data-testid="ticket">
          <BetResultDialog state="loss" finalCount={4} settled={false} onContinue={onContinue} />
        </aside>
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('YOU LOST');
    expect(dialog).toHaveTextContent('Final count: 4');
    expect(within(screen.getByTestId('ticket')).queryByRole('alertdialog')).not.toBeInTheDocument();

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    await waitFor(() => expect(continueButton).toHaveFocus());
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows a claim action for a settled win', async () => {
    render(
      <MemoryRouter>
        <BetResultDialog state="win" finalCount={20} settled totalReturn="0.2400" onContinue={() => undefined} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('YOU WIN')).toBeVisible();
    expect(screen.getByText('0.2400 ETH is ready to claim')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Claim funds' })).toHaveAttribute('href', '/profile');
  });
});

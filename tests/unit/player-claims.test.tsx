import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerClaims } from '@/components/player-claims';

const mocks = vi.hoisted(() => ({
  claimed: false,
  getLogs: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x2a1F44cE3759B8624AD8b5828EFee2dd370dCa1E',
    chainId: 421_614,
    isConnected: true,
  }),
  usePublicClient: () => ({
    getLogs: mocks.getLogs,
    readContract: mocks.readContract,
    simulateContract: mocks.simulateContract,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
}));

vi.mock('@/lib/use-eth-usd-price', () => ({ useEthUsdPrice: () => null }));

describe('PlayerClaims', () => {
  beforeEach(() => {
    mocks.claimed = false;
    mocks.getLogs.mockResolvedValue([{ args: { marketId: 1_146n } }]);
    mocks.writeContractAsync.mockImplementation(async () => '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    mocks.simulateContract.mockResolvedValue({ request: {} });
    mocks.readContract.mockImplementation(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === 'multiplierBps') {
        return ({ 1: 15_000n, 2: 17_500n, 3: 20_000n, 4: 30_000n } as Record<number, bigint>)[Number(args?.[0])];
      }
      if (functionName === 'getMarket') return {
        status: 5,
        winner: 0,
        finalCount: 0,
        closeTime: 100n,
        resolveDeadline: 200n,
        challengeDeadline: 0n,
        disputeDeadline: 0n,
      };
      if (functionName === 'claimed') return mocks.claimed;
      if (functionName === 'positions') return Number(args?.[2]) === 1 ? 1_000_000_000_000_000n : 0n;
      throw new Error(`Unexpected read: ${functionName}`);
    });
  });

  it('batches every claimable position from one Claim all action', async () => {
    render(<PlayerClaims />);

    expect(await screen.findByText('Cancelled round refund')).toBeVisible();
    expect(screen.getByText('0.001 ETH')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw (1)' }));

    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalledOnce());
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({
      address: expect.any(String),
      abi: expect.any(Array),
      functionName: 'claimAll',
      args: [[1_146n]],
      chainId: 421_614,
    }));
    expect(await screen.findByText('Refund claimed')).toBeVisible();
    expect(screen.getByText('1 claim was paid directly to your wallet.')).toBeVisible();
  });
});

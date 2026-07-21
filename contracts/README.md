# Crossflow market contract

`TrafficPredictionMarket.sol` is a bankroll-backed fixed-return ETH market. Total returns, including the original stake, are enforced on-chain at 1.5× UNDER, 1.75× RANGE, 2× OVER, and 3× EXACT. Every bet updates the worst-case liability across all open markets and reverts unless deposited liquidity covers payouts, fees, and challenge refunds. Oracle results are proposed, remain challengeable for 1 minute with a fixed bond, and become claimable only after finalization.

The platform admin is permanently pinned for detection-zone writes to `0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e`. Zones use integer basis points, have a monotonic version and canonical `keccak256(abi.encode(...))` hash, and are snapshotted when a market is created. Later zone edits cannot change an open market. Oracle and dispute-resolution calls must present that snapshot hash.

Challenges must be resolved within seven days. After that timeout, anyone can cancel the market, bettors can reclaim their stakes, and the challenger can withdraw the bond through the pull-payment refund path. Claims do not expire.

## Resolution model

The oracle submits `(finalCount, evidenceHash)`. The contract—not the oracle—maps that count to the winner:

1. `Exact` when `count == exactTarget`
2. `Under` when `count < lowerBound`
3. `Range` when `lowerBound <= count <= upperBound` and it is not exact
4. `Over` when `count > upperBound`

This priority is necessary because “Exact” otherwise overlaps “Range”. The UI must display these same rules.

`evidenceHash` should commit to a canonical result manifest containing the room ID, round timestamps, model hash, source-stream segment hashes, raw count, and oracle signer set. Store the manifest on durable content-addressed storage and publish its URI with the transaction metadata/indexer.

## Production requirements

- Compile against OpenZeppelin Contracts 5.x and Solidity 0.8.24.
- Put the default admin behind a multisig; the contract enforces a two-day admin transfer delay.
- Use four distinct constructor addresses for admin, oracle, market operator, and dispute resolver; the constructor rejects overlapping roles.
- Give `ORACLE_ROLE` to a threshold signer/automation contract, not a browser wallet, and `DISPUTE_ROLE` to an independent multisig or arbitration module.
- Add tests and an independent audit before mainnet deployment.
- A production oracle should aggregate multiple independent detector attestations and expose a dispute window. This first contract intentionally does not pretend that browser inference is trustless.

## Validation and testnet deployment

Run `npm run contract:test` for the Hardhat EVM suite. It covers fixed-admin enforcement, invalid geometry, zone snapshots, stale proof rejection, privileged-challenger rejection, pari-mutuel payouts, no-winner refunds, and stale-dispute refunds. `npm run contract:artifact` generates the Solidity 0.8.24 artifact used by the admin wallet deployment screen.

Open `/admin/zones`, connect and authenticate the fixed admin wallet, and enter three distinct public role addresses. The deployment transaction is created from the checked artifact and signed entirely inside the connected wallet. Never paste a seed phrase or private key into the application or repository. After the receipt confirms, publish each room zone on-chain before creating its first market.

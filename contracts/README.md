# Crossflow market contract

`TrafficPredictionMarket.sol` is a pari-mutuel ETH market. User stakes form the entire payout pool, so the protocol never promises uncollateralized fixed odds. Oracle results are proposed, remain challengeable for 15 minutes with a fixed bond, and become claimable only after finalization.

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
- Give `ORACLE_ROLE` to a threshold signer/automation contract, not a browser wallet, and `DISPUTE_ROLE` to an independent multisig or arbitration module.
- Add tests and an independent audit before mainnet deployment.
- A production oracle should aggregate multiple independent detector attestations and expose a dispute window. This first contract intentionally does not pretend that browser inference is trustless.

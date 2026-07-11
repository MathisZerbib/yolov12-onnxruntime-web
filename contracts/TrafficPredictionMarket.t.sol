// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TrafficPredictionMarket} from "./TrafficPredictionMarket.sol";

interface Vm {
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
}

contract TrafficPredictionMarketTest {
    address private constant ADMIN = 0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e;
    address private constant ORACLE = address(0x1001);
    address private constant MARKET_OPERATOR = address(0x1002);
    address private constant DISPUTE_RESOLVER = address(0x1003);
    address private constant ALICE = address(0x2001);
    address private constant BOB = address(0x2002);
    address private constant CHALLENGER = address(0x2003);
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant TOKYO = keccak256("tokyo");

    TrafficPredictionMarket private market;

    function setUp() public {
        market = new TrafficPredictionMarket(ADMIN, ORACLE, MARKET_OPERATOR, DISPUTE_RESOLVER);
    }

    function testConstructorPinsPlatformAdmin() public {
        require(market.PLATFORM_ADMIN() == ADMIN, "admin is not pinned");
        try new TrafficPredictionMarket(address(0x9999), ORACLE, MARKET_OPERATOR, DISPUTE_RESOLVER) {
            revert("different admin accepted");
        } catch {}
        try new TrafficPredictionMarket(ADMIN, ORACLE, ORACLE, DISPUTE_RESOLVER) {
            revert("overlapping roles accepted");
        } catch {}
    }

    function testOnlyFixedAdminCanSetZone() public {
        try market.setRoomZone(TOKYO, 0, 2_500, 10_000, 10_000, 7_500) {
            revert("unauthorized zone update accepted");
        } catch {}

        vm.prank(ADMIN);
        market.setRoomZone(TOKYO, 0, 2_500, 10_000, 10_000, 7_500);
        (uint16 x1, uint16 y1, uint16 x2, uint16 y2, uint16 line, uint32 version, bytes32 configHash) = market.roomZones(TOKYO);
        require(x1 == 0 && y1 == 2_500 && x2 == 10_000 && y2 == 10_000 && line == 7_500, "zone coordinates differ");
        require(version == 1, "first zone version is not one");
        require(configHash == keccak256(abi.encode(TOKYO, x1, y1, x2, y2, line)), "zone hash differs");
    }

    function testInvalidZoneGeometryReverts() public {
        vm.prank(ADMIN);
        try market.setRoomZone(TOKYO, 5_000, 2_500, 5_000, 10_000, 7_500) {
            revert("zero-width zone accepted");
        } catch {}

        vm.prank(ADMIN);
        try market.setRoomZone(TOKYO, 0, 2_500, 10_000, 10_000, 2_000) {
            revert("line outside zone accepted");
        } catch {}
    }

    function testMarketRequiresZoneAndSnapshotsIt() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        vm.prank(MARKET_OPERATOR);
        try market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250) {
            revert("market without zone accepted");
        } catch {}

        bytes32 firstHash = _setTokyoZone(7_500);
        vm.prank(MARKET_OPERATOR);
        uint256 marketId = market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250);
        TrafficPredictionMarket.Market memory created = market.getMarket(marketId);
        require(created.zoneVersion == 1, "zone version not snapshotted");
        require(created.zoneConfigHash == firstHash, "zone hash not snapshotted");

        _setTokyoZone(8_000);
        TrafficPredictionMarket.Market memory unchanged = market.getMarket(marketId);
        require(unchanged.zoneVersion == 1 && unchanged.zoneConfigHash == firstHash, "open market zone mutated");
    }

    function testOracleCannotResolveWithChangedZone() public {
        bytes32 firstHash = _setTokyoZone(7_500);
        uint64 closeTime = uint64(block.timestamp + 60);
        vm.prank(MARKET_OPERATOR);
        uint256 marketId = market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250);
        bytes32 changedHash = _setTokyoZone(8_000);
        bytes32 evidenceHash = keccak256("manifest-v2");
        vm.warp(closeTime);

        vm.prank(ORACLE);
        try market.proposeResult(marketId, 8, evidenceHash, changedHash) {
            revert("stale market accepted changed zone");
        } catch {}

        vm.prank(ORACLE);
        market.proposeResult(marketId, 8, evidenceHash, firstHash);
        TrafficPredictionMarket.Market memory proposed = market.getMarket(marketId);
        require(proposed.status == TrafficPredictionMarket.Status.Proposed, "result was not proposed");
        require(proposed.evidenceHash == evidenceHash, "evidence hash differs");
    }

    function testParimutuelPoolPaysOnlyWinningStake() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        uint256 marketId = _createTokyoMarket(closeTime, 250);
        vm.deal(ALICE, 2 ether);
        vm.deal(BOB, 2 ether);
        vm.prank(ALICE);
        market.bet{value: 1 ether}(marketId, TrafficPredictionMarket.Outcome.Range);
        vm.prank(BOB);
        market.bet{value: 1 ether}(marketId, TrafficPredictionMarket.Outcome.Over);

        _proposeAndFinalize(marketId, closeTime, 8);
        TrafficPredictionMarket.Market memory resolved = market.getMarket(marketId);
        require(resolved.status == TrafficPredictionMarket.Status.Resolved, "market not resolved");
        require(resolved.winner == TrafficPredictionMarket.Outcome.Range, "wrong winner");
        require(market.protocolFees() == 0.05 ether, "wrong protocol fee");

        uint256 beforeClaim = ALICE.balance;
        vm.prank(ALICE);
        market.claim(marketId);
        require(ALICE.balance - beforeClaim == 1.95 ether, "wrong pari-mutuel payout");
        vm.prank(BOB);
        try market.claim(marketId) { revert("loser claimed funds"); } catch {}
        vm.prank(ALICE);
        try market.claim(marketId) { revert("winner claimed twice"); } catch {}
    }

    function testNoWinnerCancelsAndRefundsEveryStake() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        uint256 marketId = _createTokyoMarket(closeTime, 500);
        vm.deal(ALICE, 2 ether);
        vm.deal(BOB, 2 ether);
        vm.prank(ALICE);
        market.bet{value: 0.7 ether}(marketId, TrafficPredictionMarket.Outcome.Under);
        vm.prank(BOB);
        market.bet{value: 1.1 ether}(marketId, TrafficPredictionMarket.Outcome.Range);

        _proposeAndFinalize(marketId, closeTime, 20);
        require(market.getMarket(marketId).status == TrafficPredictionMarket.Status.Cancelled, "empty winner pool did not cancel");
        uint256 aliceBefore = ALICE.balance;
        uint256 bobBefore = BOB.balance;
        vm.prank(ALICE);
        market.claim(marketId);
        vm.prank(BOB);
        market.claim(marketId);
        require(ALICE.balance - aliceBefore == 0.7 ether && BOB.balance - bobBefore == 1.1 ether, "cancelled stakes not refunded");
        require(market.protocolFees() == 0, "cancelled market charged a fee");
    }

    function testStaleChallengeCancelsMarketAndRefundsBond() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        uint256 marketId = _createTokyoMarket(closeTime, 250);
        vm.deal(ALICE, 2 ether);
        vm.deal(CHALLENGER, 1 ether);
        vm.prank(ALICE);
        market.bet{value: 1 ether}(marketId, TrafficPredictionMarket.Outcome.Range);
        vm.warp(closeTime);
        bytes32 zoneHash = market.getMarket(marketId).zoneConfigHash;
        vm.prank(ORACLE);
        market.proposeResult(marketId, 8, keccak256("oracle evidence"), zoneHash);
        uint256 bond = market.CHALLENGE_BOND();
        vm.prank(CHALLENGER);
        market.challengeResult{value: bond}(marketId, keccak256("challenger evidence"));
        TrafficPredictionMarket.Market memory challenged = market.getMarket(marketId);
        vm.warp(challenged.disputeDeadline + 1);
        market.cancelStaleChallenge(marketId);
        require(market.getMarket(marketId).status == TrafficPredictionMarket.Status.Cancelled, "stale dispute not cancelled");
        require(market.challengeRefunds(CHALLENGER) == bond, "bond refund not accrued");
        uint256 challengerBefore = CHALLENGER.balance;
        vm.prank(CHALLENGER);
        market.withdrawChallengeRefund();
        require(CHALLENGER.balance - challengerBefore == bond, "bond not withdrawn");
        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE);
        market.claim(marketId);
        require(ALICE.balance - aliceBefore == 1 ether, "bettor not refunded");
    }

    function testPrivilegedAdminCannotChallengeAndResolverUsesSnapshotZone() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        uint256 marketId = _createTokyoMarket(closeTime, 250);
        vm.deal(ADMIN, 1 ether);
        vm.deal(CHALLENGER, 1 ether);
        vm.warp(closeTime);
        bytes32 snapshotHash = market.getMarket(marketId).zoneConfigHash;
        vm.prank(ORACLE);
        market.proposeResult(marketId, 8, keccak256("oracle evidence"), snapshotHash);
        uint256 bond = market.CHALLENGE_BOND();
        vm.prank(ADMIN);
        try market.challengeResult{value: bond}(marketId, keccak256("admin evidence")) {
            revert("platform admin was allowed to challenge");
        } catch {}

        vm.prank(CHALLENGER);
        market.challengeResult{value: bond}(marketId, keccak256("independent evidence"));
        vm.prank(DISPUTE_RESOLVER);
        try market.resolveChallenge(marketId, 9, keccak256("final evidence"), bytes32(uint256(1)), true) {
            revert("resolver accepted a different zone");
        } catch {}
        vm.prank(DISPUTE_RESOLVER);
        market.resolveChallenge(marketId, 9, keccak256("final evidence"), snapshotHash, true);
        require(market.getMarket(marketId).status == TrafficPredictionMarket.Status.Cancelled, "empty winner pool did not cancel");
        require(market.challengeRefunds(CHALLENGER) == bond, "successful challenger bond not accrued");
    }

    function _setTokyoZone(uint16 line) private returns (bytes32) {
        vm.prank(ADMIN);
        market.setRoomZone(TOKYO, 0, 2_500, 10_000, 10_000, line);
        (,,,,,, bytes32 configHash) = market.roomZones(TOKYO);
        return configHash;
    }

    function _createTokyoMarket(uint64 closeTime, uint16 feeBps) private returns (uint256) {
        _setTokyoZone(7_500);
        vm.prank(MARKET_OPERATOR);
        return market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, feeBps);
    }

    function _proposeAndFinalize(uint256 marketId, uint64 closeTime, uint32 count) private {
        vm.warp(closeTime);
        bytes32 zoneHash = market.getMarket(marketId).zoneConfigHash;
        vm.prank(ORACLE);
        market.proposeResult(marketId, count, keccak256("manifest"), zoneHash);
        TrafficPredictionMarket.Market memory proposed = market.getMarket(marketId);
        vm.warp(proposed.challengeDeadline + 1);
        market.finalizeResult(marketId);
    }
}

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
    bytes32 private constant PARIS = keccak256("paris");

    TrafficPredictionMarket private market;

    function setUp() public {
        market = new TrafficPredictionMarket(ADMIN, ORACLE, MARKET_OPERATOR, DISPUTE_RESOLVER);
        vm.deal(ADMIN, 100 ether);
        vm.prank(ADMIN);
        market.fundLiquidity{value: 100 ether}();
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
        try market.setRoomZone(TOKYO, _geometry()) {
            revert("unauthorized zone update accepted");
        } catch {}

        vm.prank(ADMIN);
        market.setRoomZone(TOKYO, _geometry());
        (uint16 tlx, uint16 tly, uint16 trx, uint16 try_, uint16 brx, uint16 bry, uint16 blx, uint16 bly, uint32 version, bytes32 configHash) = market.roomZones(TOKYO);
        require(tlx == 1_000 && tly == 2_500 && trx == 9_000 && try_ == 2_500 && brx == 10_000 && bry == 10_000 && blx == 0 && bly == 10_000, "zone coordinates differ");
        require(version == 1, "first zone version is not one");
        require(configHash == keccak256(abi.encode(TOKYO, _geometry())), "zone hash differs");
    }

    function testAdminPublishesAllZonesAtomically() public {
        bytes32[] memory rooms = new bytes32[](2);
        rooms[0] = TOKYO; rooms[1] = PARIS;
        uint16[8][] memory geometries = new uint16[8][](2);
        geometries[0] = _geometry(); geometries[1] = _geometry();
        vm.prank(ADMIN);
        market.setRoomZones(rooms, geometries);
        (,,,,,,,, uint32 tokyoVersion,) = market.roomZones(TOKYO);
        (,,,,,,,, uint32 parisVersion,) = market.roomZones(PARIS);
        require(tokyoVersion == 1 && parisVersion == 1, "batch zone publication failed");
    }

    function testAdminAtomicallyRotatesOperationalRole() public {
        address nextOracle = address(0x4001);
        bytes32 oracleRole = market.ORACLE_ROLE();
        bytes32 marketRole = market.MARKET_ROLE();
        vm.prank(ADMIN);
        market.rotateOperationalRole(oracleRole, nextOracle);
        require(market.roleAccount(oracleRole) == nextOracle, "role account not updated");
        require(market.hasRole(oracleRole, nextOracle), "new oracle lacks role");
        require(!market.hasRole(oracleRole, ORACLE), "old oracle retained role");

        vm.prank(ALICE);
        try market.rotateOperationalRole(marketRole, address(0x4002)) { revert("non-admin rotated role"); } catch {}
        vm.prank(ADMIN);
        try market.rotateOperationalRole(marketRole, nextOracle) { revert("overlapping role accepted"); } catch {}
    }

    function testAdminRotatesAllOperationalRolesInOneCall() public {
        address nextOracle = address(0x5001);
        address nextMarket = address(0x5002);
        address nextDispute = address(0x5003);
        vm.prank(ADMIN);
        market.rotateAllOperationalRoles(nextOracle, nextMarket, nextDispute);
        require(market.roleAccount(market.ORACLE_ROLE()) == nextOracle, "oracle not rotated");
        require(market.roleAccount(market.MARKET_ROLE()) == nextMarket, "market role not rotated");
        require(market.roleAccount(market.DISPUTE_ROLE()) == nextDispute, "dispute role not rotated");
    }

    function testInvalidZoneGeometryReverts() public {
        vm.prank(ADMIN);
        uint16[8] memory zeroWidth = _geometry();
        zeroWidth[0] = zeroWidth[2];
        try market.setRoomZone(TOKYO, zeroWidth) {
            revert("zero-width zone accepted");
        } catch {}

    }

    function testMarketRequiresZoneAndSnapshotsIt() public {
        uint64 closeTime = uint64(block.timestamp + 60);
        vm.prank(MARKET_OPERATOR);
        try market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250) {
            revert("market without zone accepted");
        } catch {}

        bytes32 firstHash = _setTokyoZone();
        vm.prank(MARKET_OPERATOR);
        uint256 marketId = market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250);
        TrafficPredictionMarket.Market memory created = market.getMarket(marketId);
        require(created.zoneVersion == 1, "zone version not snapshotted");
        require(created.zoneConfigHash == firstHash, "zone hash not snapshotted");

        _setTokyoZone();
        TrafficPredictionMarket.Market memory unchanged = market.getMarket(marketId);
        require(unchanged.zoneVersion == 1 && unchanged.zoneConfigHash == firstHash, "open market zone mutated");
    }

    function testRoomSupportsRollingMarketsAndAdvancesSequentially() public {
        _setTokyoZone();
        uint64 firstClose = uint64(block.timestamp + 5 minutes);
        vm.prank(MARKET_OPERATOR);
        uint256 firstId = market.createMarket(TOKYO, firstClose, firstClose + 10 minutes, 10, 30, 20, 200);
        require(market.latestMarketIdByRoom(TOKYO) == firstId, "room pointer did not select first market");

        vm.prank(MARKET_OPERATOR);
        uint256 rollingId = market.createMarket(TOKYO, firstClose + 5 minutes, firstClose + 15 minutes, 10, 30, 20, 200);
        require(rollingId == firstId + 1, "rolling market was not created");
        require(market.latestMarketIdByRoom(TOKYO) == rollingId, "latest pointer did not advance to rolling market");

        vm.warp(firstClose);
        uint64 secondClose = uint64(block.timestamp + 5 minutes);
        vm.prank(MARKET_OPERATOR);
        uint256 secondId = market.createMarket(TOKYO, secondClose, secondClose + 10 minutes, 10, 30, 20, 200);
        require(secondId == rollingId + 1, "market sequence is not monotonic");
        require(market.latestMarketIdByRoom(TOKYO) == secondId, "room pointer did not advance");
        require(market.getMarket(firstId).status == TrafficPredictionMarket.Status.Open, "previous settlement state was mutated");
    }

    function testMarketTimingAndTargetsAreBounded() public {
        _setTokyoZone();
        uint64 tooSoon = uint64(block.timestamp + market.MIN_BETTING_PERIOD() - 1);
        vm.prank(MARKET_OPERATOR);
        try market.createMarket(TOKYO, tooSoon, tooSoon + 10 minutes, 10, 30, 20, 200) {
            revert("too-short betting window accepted");
        } catch {}

        uint64 closeTime = uint64(block.timestamp + 5 minutes);
        vm.prank(MARKET_OPERATOR);
        try market.createMarket(TOKYO, closeTime, closeTime + 10 minutes, 10, 30, 31, 200) {
            revert("exact target outside market range accepted");
        } catch {}
    }

    function testDifferentRoomsCanAcceptBetsConcurrently() public {
        _setTokyoZone();
        vm.prank(ADMIN);
        market.setRoomZone(PARIS, _geometry());
        uint64 closeTime = uint64(block.timestamp + 5 minutes);
        vm.prank(MARKET_OPERATOR);
        uint256 tokyoId = market.createMarket(TOKYO, closeTime, closeTime + 10 minutes, 10, 30, 20, 200);
        vm.prank(MARKET_OPERATOR);
        uint256 parisId = market.createMarket(PARIS, closeTime, closeTime + 10 minutes, 10, 30, 20, 200);
        require(market.latestMarketIdByRoom(TOKYO) == tokyoId, "Tokyo pointer changed");
        require(market.latestMarketIdByRoom(PARIS) == parisId, "Paris pointer missing");
        require(market.isMarketBettable(tokyoId) && market.isMarketBettable(parisId), "concurrent room market not bettable");
    }

    function testOracleCannotResolveWithChangedZone() public {
        bytes32 firstHash = _setTokyoZone();
        uint64 closeTime = uint64(block.timestamp + 60);
        vm.prank(MARKET_OPERATOR);
        uint256 marketId = market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 250);
        uint16[8] memory changedGeometry = _geometry();
        changedGeometry[0] = 1_200;
        vm.prank(ADMIN);
        market.setRoomZone(TOKYO, changedGeometry);
        (,,,,,,,,, bytes32 changedHash) = market.roomZones(TOKYO);
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

    function testFixedRangeReturnPaysGuaranteedMultiplier() public {
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
        require(market.protocolFees() == 0.00625 ether, "wrong protocol fee");

        uint256 beforeClaim = ALICE.balance;
        vm.prank(ALICE);
        market.claim(marketId);
        require(ALICE.balance - beforeClaim == 1.75 ether, "wrong fixed return");
        vm.prank(BOB);
        try market.claim(marketId) { revert("loser claimed funds"); } catch {}
        vm.prank(ALICE);
        try market.claim(marketId) { revert("winner claimed twice"); } catch {}
    }

    function testFixedMultipliersAndLiquidityGuard() public {
        require(market.multiplierBps(TrafficPredictionMarket.Outcome.Under) == 15_000, "under multiplier changed");
        require(market.multiplierBps(TrafficPredictionMarket.Outcome.Range) == 17_500, "range multiplier changed");
        require(market.multiplierBps(TrafficPredictionMarket.Outcome.Over) == 20_000, "over multiplier changed");
        require(market.multiplierBps(TrafficPredictionMarket.Outcome.Exact) == 30_000, "exact multiplier changed");

        uint64 closeTime = uint64(block.timestamp + 60);
        uint256 marketId = _createTokyoMarket(closeTime, 200);
        vm.deal(ALICE, 2 ether);
        vm.prank(ALICE);
        market.bet{value: 1 ether}(marketId, TrafficPredictionMarket.Outcome.Exact);
        _proposeAndFinalize(marketId, closeTime, 7);
        uint256 beforeClaim = ALICE.balance;
        vm.prank(ALICE);
        market.claim(marketId);
        require(ALICE.balance - beforeClaim == 3 ether, "exact return is not guaranteed at 3x");

        TrafficPredictionMarket emptyMarket = new TrafficPredictionMarket(ADMIN, ORACLE, MARKET_OPERATOR, DISPUTE_RESOLVER);
        vm.prank(ADMIN);
        emptyMarket.setRoomZone(TOKYO, _geometry());
        vm.prank(MARKET_OPERATOR);
        uint256 unfundedId = emptyMarket.createMarket(TOKYO, uint64(block.timestamp + 60), uint64(block.timestamp + 1 days), 5, 10, 7, 200);
        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        try emptyMarket.bet{value: 1 ether}(unfundedId, TrafficPredictionMarket.Outcome.Exact) {
            revert("unfunded fixed return accepted");
        } catch {}
    }

    function testUnderAndOverReturnsAreGuaranteed() public {
        _setTokyoZone();
        vm.prank(ADMIN);
        market.setRoomZone(PARIS, _geometry());
        uint64 closeTime = uint64(block.timestamp + 60);
        vm.prank(MARKET_OPERATOR);
        uint256 underMarket = market.createMarket(TOKYO, closeTime, closeTime + 1 days, 5, 10, 7, 200);
        vm.prank(MARKET_OPERATOR);
        uint256 overMarket = market.createMarket(PARIS, closeTime, closeTime + 1 days, 5, 10, 7, 200);
        vm.deal(ALICE, 3 ether);
        vm.prank(ALICE);
        market.bet{value: 1 ether}(underMarket, TrafficPredictionMarket.Outcome.Under);
        vm.prank(ALICE);
        market.bet{value: 1 ether}(overMarket, TrafficPredictionMarket.Outcome.Over);
        _proposeAndFinalize(underMarket, closeTime, 4);
        uint256 afterFirstFinalization = block.timestamp;
        bytes32 parisHash = market.getMarket(overMarket).zoneConfigHash;
        vm.prank(ORACLE);
        market.proposeResult(overMarket, 11, keccak256("over-manifest"), parisHash);
        TrafficPredictionMarket.Market memory proposed = market.getMarket(overMarket);
        vm.warp(proposed.challengeDeadline + 1);
        market.finalizeResult(overMarket);
        require(block.timestamp > afterFirstFinalization, "second market did not finalize");

        uint256 beforeUnder = ALICE.balance;
        vm.prank(ALICE);
        market.claim(underMarket);
        require(ALICE.balance - beforeUnder == 1.5 ether, "under return is not guaranteed at 1.5x");
        uint256 beforeOver = ALICE.balance;
        vm.prank(ALICE);
        market.claim(overMarket);
        require(ALICE.balance - beforeOver == 2 ether, "over return is not guaranteed at 2x");
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

    function _setTokyoZone() private returns (bytes32) {
        vm.prank(ADMIN);
        market.setRoomZone(TOKYO, _geometry());
        (,,,,,,,,, bytes32 configHash) = market.roomZones(TOKYO);
        return configHash;
    }

    function _geometry() private pure returns (uint16[8] memory geometry) {
        geometry = [uint16(1_000), 2_500, 9_000, 2_500, 10_000, 10_000, 0, 10_000];
    }

    function _createTokyoMarket(uint64 closeTime, uint16 feeBps) private returns (uint256) {
        _setTokyoZone();
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

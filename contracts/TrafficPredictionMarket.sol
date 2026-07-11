// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Crossflow Traffic Prediction Market
/// @notice Solvent, pari-mutuel ETH markets resolved from an authorized vehicle-count oracle.
contract TrafficPredictionMarket is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    address public constant PLATFORM_ADMIN = 0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e;
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint64 public constant CLAIM_PERIOD = 90 days;
    uint64 public constant CHALLENGE_PERIOD = 15 minutes;
    uint64 public constant DISPUTE_PERIOD = 7 days;
    uint256 public constant CHALLENGE_BOND = 0.01 ether;

    enum Outcome { None, Under, Range, Over, Exact }
    enum Status { None, Open, Proposed, Challenged, Resolved, Cancelled }

    struct RoomZone {
        uint16 x1Bps;
        uint16 y1Bps;
        uint16 x2Bps;
        uint16 y2Bps;
        uint16 countingLineYBps;
        uint32 version;
        bytes32 configHash;
    }

    struct Market {
        bytes32 roomId;
        uint64 closeTime;
        uint64 resolveDeadline;
        uint64 claimDeadline;
        uint64 challengeDeadline;
        uint64 disputeDeadline;
        uint32 lowerBound;
        uint32 upperBound;
        uint32 exactTarget;
        uint32 finalCount;
        uint32 zoneVersion;
        uint16 feeBps;
        Outcome winner;
        Status status;
        bytes32 evidenceHash;
        bytes32 zoneConfigHash;
        bytes32 challengerEvidenceHash;
        address challenger;
        uint256 totalPool;
        uint256 winningPool;
    }

    uint256 public nextMarketId = 1;
    uint256 public protocolFees;
    mapping(uint256 => Market) private markets;
    mapping(uint256 => mapping(Outcome => uint256)) public outcomePools;
    mapping(uint256 => mapping(address => mapping(Outcome => uint256))) public positions;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public challengeRefunds;
    mapping(bytes32 => RoomZone) public roomZones;

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    error InvalidMarket();
    error InvalidConfiguration();
    error MarketClosed();
    error MarketNotClosed();
    error MarketNotClaimable();
    error InvalidStake();
    error AlreadyClaimed();
    error TransferFailed();
    error UnauthorizedZoneAdmin();
    error StaleZoneConfiguration();

    event RoomZoneUpdated(bytes32 indexed roomId, uint32 indexed version, bytes32 indexed configHash, uint16 x1Bps, uint16 y1Bps, uint16 x2Bps, uint16 y2Bps, uint16 countingLineYBps);
    event MarketCreated(uint256 indexed marketId, bytes32 indexed roomId, uint64 closeTime, uint32 lowerBound, uint32 upperBound, uint32 exactTarget, uint32 zoneVersion, bytes32 zoneConfigHash);
    event PositionOpened(uint256 indexed marketId, address indexed account, Outcome indexed outcome, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint32 finalCount, Outcome winner, bytes32 indexed evidenceHash);
    event ResultProposed(uint256 indexed marketId, uint32 finalCount, bytes32 indexed evidenceHash, bytes32 indexed zoneConfigHash, uint64 challengeDeadline);
    event ResultChallenged(uint256 indexed marketId, address indexed challenger, bytes32 indexed challengerEvidenceHash);
    event MarketCancelled(uint256 indexed marketId);
    event Claimed(uint256 indexed marketId, address indexed account, uint256 amount);
    event ChallengeRefundAccrued(address indexed challenger, uint256 amount);

    constructor(address admin, address oracle, address marketOperator, address disputeResolver)
        AccessControlDefaultAdminRules(2 days, admin)
    {
        if (admin != PLATFORM_ADMIN || oracle == address(0) || marketOperator == address(0) || disputeResolver == address(0) ||
            admin == oracle || admin == marketOperator || admin == disputeResolver || oracle == marketOperator ||
            oracle == disputeResolver || marketOperator == disputeResolver) revert InvalidConfiguration();
        _grantRole(ORACLE_ROLE, oracle);
        _grantRole(MARKET_ROLE, marketOperator);
        _grantRole(DISPUTE_ROLE, disputeResolver);
    }

    /// @notice Defines the normalized rectangle and counting line for future markets in a room.
    /// @dev Basis points remove floating-point ambiguity across browser, Worker, and EVM manifests.
    ///      The fixed address check remains authoritative even if AccessControl admin ownership changes.
    function setRoomZone(
        bytes32 roomId,
        uint16 x1Bps,
        uint16 y1Bps,
        uint16 x2Bps,
        uint16 y2Bps,
        uint16 countingLineYBps
    ) external {
        if (msg.sender != PLATFORM_ADMIN) revert UnauthorizedZoneAdmin();
        if (roomId == bytes32(0) || x2Bps > 10_000 || y2Bps > 10_000 || x1Bps >= x2Bps || y1Bps >= y2Bps ||
            countingLineYBps < y1Bps || countingLineYBps > y2Bps) revert InvalidConfiguration();

        RoomZone storage zone = roomZones[roomId];
        uint32 nextVersion = zone.version + 1;
        bytes32 configHash = keccak256(abi.encode(roomId, x1Bps, y1Bps, x2Bps, y2Bps, countingLineYBps));
        roomZones[roomId] = RoomZone(x1Bps, y1Bps, x2Bps, y2Bps, countingLineYBps, nextVersion, configHash);
        emit RoomZoneUpdated(roomId, nextVersion, configHash, x1Bps, y1Bps, x2Bps, y2Bps, countingLineYBps);
    }

    function createMarket(
        bytes32 roomId,
        uint64 closeTime,
        uint64 resolveDeadline,
        uint32 lowerBound,
        uint32 upperBound,
        uint32 exactTarget,
        uint16 feeBps
    ) external onlyRole(MARKET_ROLE) whenNotPaused returns (uint256 marketId) {
        if (roomId == bytes32(0) || closeTime <= block.timestamp || resolveDeadline <= closeTime ||
            lowerBound > upperBound || feeBps > MAX_FEE_BPS) revert InvalidConfiguration();
        RoomZone storage zone = roomZones[roomId];
        if (zone.version == 0) revert InvalidConfiguration();

        marketId = nextMarketId++;
        Market storage market = markets[marketId];
        market.roomId = roomId;
        market.closeTime = closeTime;
        market.resolveDeadline = resolveDeadline;
        market.lowerBound = lowerBound;
        market.upperBound = upperBound;
        market.exactTarget = exactTarget;
        market.zoneVersion = zone.version;
        market.zoneConfigHash = zone.configHash;
        market.feeBps = feeBps;
        market.status = Status.Open;
        emit MarketCreated(marketId, roomId, closeTime, lowerBound, upperBound, exactTarget, zone.version, zone.configHash);
    }

    function bet(uint256 marketId, Outcome outcome) external payable whenNotPaused {
        Market storage market = markets[marketId];
        if (market.status != Status.Open) revert InvalidMarket();
        if (block.timestamp >= market.closeTime) revert MarketClosed();
        if (outcome == Outcome.None) revert InvalidConfiguration();
        if (msg.value == 0) revert InvalidStake();

        positions[marketId][msg.sender][outcome] += msg.value;
        outcomePools[marketId][outcome] += msg.value;
        market.totalPool += msg.value;
        emit PositionOpened(marketId, msg.sender, outcome, msg.value);
    }

    /// @dev The oracle submits only facts. Outcome selection remains deterministic on-chain.
    function proposeResult(uint256 marketId, uint32 finalCount, bytes32 evidenceHash, bytes32 zoneConfigHash) external onlyRole(ORACLE_ROLE) {
        Market storage market = markets[marketId];
        if (market.status != Status.Open) revert InvalidMarket();
        if (block.timestamp < market.closeTime) revert MarketNotClosed();
        if (block.timestamp > market.resolveDeadline || evidenceHash == bytes32(0)) revert InvalidConfiguration();
        if (zoneConfigHash != market.zoneConfigHash) revert StaleZoneConfiguration();

        market.finalCount = finalCount;
        market.evidenceHash = evidenceHash;
        market.challengeDeadline = uint64(block.timestamp + CHALLENGE_PERIOD);
        market.status = Status.Proposed;
        emit ResultProposed(marketId, finalCount, evidenceHash, zoneConfigHash, market.challengeDeadline);
    }

    function challengeResult(uint256 marketId, bytes32 challengerEvidenceHash) external payable {
        Market storage market = markets[marketId];
        if (market.status != Status.Proposed || block.timestamp > market.challengeDeadline || challengerEvidenceHash == bytes32(0) || msg.value != CHALLENGE_BOND ||
            msg.sender == PLATFORM_ADMIN || hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(ORACLE_ROLE, msg.sender) ||
            hasRole(MARKET_ROLE, msg.sender) || hasRole(DISPUTE_ROLE, msg.sender)) revert InvalidConfiguration();
        market.status = Status.Challenged;
        market.disputeDeadline = uint64(block.timestamp + DISPUTE_PERIOD);
        market.challenger = msg.sender;
        market.challengerEvidenceHash = challengerEvidenceHash;
        emit ResultChallenged(marketId, msg.sender, challengerEvidenceHash);
    }

    function finalizeResult(uint256 marketId) external {
        Market storage market = markets[marketId];
        if (market.status != Status.Proposed || block.timestamp <= market.challengeDeadline) revert InvalidConfiguration();
        _finalize(marketId, market.finalCount, market.evidenceHash);
    }

    function resolveChallenge(uint256 marketId, uint32 finalCount, bytes32 finalEvidenceHash, bytes32 zoneConfigHash, bool challengerSucceeded) external onlyRole(DISPUTE_ROLE) nonReentrant {
        Market storage market = markets[marketId];
        if (market.status != Status.Challenged || block.timestamp > market.disputeDeadline || finalEvidenceHash == bytes32(0)) revert InvalidConfiguration();
        if (zoneConfigHash != market.zoneConfigHash) revert StaleZoneConfiguration();
        if (challengerSucceeded) {
            challengeRefunds[market.challenger] += CHALLENGE_BOND;
            emit ChallengeRefundAccrued(market.challenger, CHALLENGE_BOND);
        } else protocolFees += CHALLENGE_BOND;
        _finalize(marketId, finalCount, finalEvidenceHash);
    }

    function cancelStaleChallenge(uint256 marketId) external {
        Market storage market = markets[marketId];
        if (market.status != Status.Challenged || block.timestamp <= market.disputeDeadline) revert InvalidConfiguration();
        challengeRefunds[market.challenger] += CHALLENGE_BOND;
        market.status = Status.Cancelled;
        market.claimDeadline = uint64(block.timestamp + CLAIM_PERIOD);
        emit ChallengeRefundAccrued(market.challenger, CHALLENGE_BOND);
        emit MarketCancelled(marketId);
    }

    function withdrawChallengeRefund() external nonReentrant {
        uint256 amount = challengeRefunds[msg.sender];
        if (amount == 0) revert InvalidStake();
        challengeRefunds[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _finalize(uint256 marketId, uint32 finalCount, bytes32 finalEvidenceHash) internal {
        Market storage market = markets[marketId];
        Outcome winner = outcomeFor(marketId, finalCount);
        uint256 winningPool = outcomePools[marketId][winner];
        market.finalCount = finalCount;
        market.evidenceHash = finalEvidenceHash;
        market.claimDeadline = uint64(block.timestamp + CLAIM_PERIOD);

        // With no winners, cancellation returns every stake and charges no fee.
        if (winningPool == 0) {
            market.status = Status.Cancelled;
            emit MarketCancelled(marketId);
            return;
        }

        uint256 fee = market.totalPool * market.feeBps / 10_000;
        protocolFees += fee;
        market.winner = winner;
        market.winningPool = winningPool;
        market.status = Status.Resolved;
        emit MarketResolved(marketId, finalCount, winner, finalEvidenceHash);
    }

    function outcomeFor(uint256 marketId, uint32 count) public view returns (Outcome) {
        Market storage market = markets[marketId];
        if (market.status == Status.None) revert InvalidMarket();
        // Exact takes priority; remaining outcomes form a mutually-exclusive partition.
        if (count == market.exactTarget) return Outcome.Exact;
        if (count < market.lowerBound) return Outcome.Under;
        if (count <= market.upperBound) return Outcome.Range;
        return Outcome.Over;
    }

    function claim(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        if (market.status != Status.Resolved && market.status != Status.Cancelled) revert MarketNotClaimable();
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();
        claimed[marketId][msg.sender] = true;

        uint256 amount;
        if (market.status == Status.Cancelled) {
            amount = positions[marketId][msg.sender][Outcome.Under]
                + positions[marketId][msg.sender][Outcome.Range]
                + positions[marketId][msg.sender][Outcome.Over]
                + positions[marketId][msg.sender][Outcome.Exact];
        } else {
            uint256 stake = positions[marketId][msg.sender][market.winner];
            uint256 distributable = market.totalPool - (market.totalPool * market.feeBps / 10_000);
            amount = stake * distributable / market.winningPool;
        }
        if (amount == 0) revert InvalidStake();
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Claimed(marketId, msg.sender, amount);
    }

    function cancelExpired(uint256 marketId) external {
        Market storage market = markets[marketId];
        if (market.status != Status.Open || block.timestamp <= market.resolveDeadline) revert InvalidMarket();
        market.status = Status.Cancelled;
        market.claimDeadline = uint64(block.timestamp + CLAIM_PERIOD);
        emit MarketCancelled(marketId);
    }

    function withdrawFees(address payable recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (recipient == address(0) || amount > protocolFees) revert InvalidConfiguration();
        protocolFees -= amount;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}

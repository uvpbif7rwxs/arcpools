// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcPoolsRegistry
/// @notice Anchors compact ArcPools dataset receipts. Pool data remains offchain.
contract ArcPoolsRegistry {
    struct SnapshotReceipt {
        bytes32 snapshotHash;
        uint64 capturedAt;
        uint32 poolCount;
        uint32 schemaVersion;
    }

    address public immutable publisher;
    SnapshotReceipt public latestSnapshot;

    error NotPublisher();
    error EmptySnapshotHash();

    event SnapshotAnchored(
        bytes32 indexed snapshotHash,
        uint64 capturedAt,
        uint32 poolCount,
        uint32 schemaVersion,
        address indexed publisher
    );

    constructor() {
        publisher = msg.sender;
    }

    function anchorSnapshot(
        bytes32 snapshotHash,
        uint64 capturedAt,
        uint32 poolCount,
        uint32 schemaVersion
    ) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (snapshotHash == bytes32(0)) revert EmptySnapshotHash();

        latestSnapshot = SnapshotReceipt({
            snapshotHash: snapshotHash,
            capturedAt: capturedAt,
            poolCount: poolCount,
            schemaVersion: schemaVersion
        });

        emit SnapshotAnchored(snapshotHash, capturedAt, poolCount, schemaVersion, msg.sender);
    }
}

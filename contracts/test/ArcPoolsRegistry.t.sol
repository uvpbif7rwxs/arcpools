// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcPoolsRegistry} from "../src/ArcPoolsRegistry.sol";

contract OtherPublisher {
    function anchor(ArcPoolsRegistry registry) external {
        registry.anchorSnapshot(bytes32(uint256(1)), 1, 1, 1);
    }
}

contract ArcPoolsRegistryTest {
    function testPublisherIsDeployer() public {
        ArcPoolsRegistry registry = new ArcPoolsRegistry();
        require(registry.publisher() == address(this), "wrong publisher");
    }

    function testPublisherCanAnchorAndReadSnapshot() public {
        ArcPoolsRegistry registry = new ArcPoolsRegistry();
        bytes32 snapshotHash = keccak256("arcpools-snapshot");

        registry.anchorSnapshot(snapshotHash, 1_792_000_000, 364, 1);

        (bytes32 storedHash, uint64 capturedAt, uint32 poolCount, uint32 schemaVersion) =
            registry.latestSnapshot();
        require(storedHash == snapshotHash, "wrong hash");
        require(capturedAt == 1_792_000_000, "wrong timestamp");
        require(poolCount == 364, "wrong pool count");
        require(schemaVersion == 1, "wrong schema version");
    }

    function testOtherAddressCannotAnchor() public {
        ArcPoolsRegistry registry = new ArcPoolsRegistry();
        OtherPublisher other = new OtherPublisher();

        try other.anchor(registry) {
            revert("unauthorized anchor succeeded");
        } catch {}
    }

    function testEmptyHashIsRejected() public {
        ArcPoolsRegistry registry = new ArcPoolsRegistry();

        try registry.anchorSnapshot(bytes32(0), 1, 1, 1) {
            revert("empty snapshot hash accepted");
        } catch {}
    }
}

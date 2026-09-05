// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  FileRegistry
 * @notice ARUOTES ZVault — Zero-Knowledge Access Control Registry (Option C: Event-Driven)
 *
 * @dev    Architecture principles enforced in this contract:
 *
 *         DATA MINIMIZATION
 *         ─────────────────
 *         CIDs and encrypted key payloads are NEVER stored in EVM state storage.
 *         They are accepted as `calldata` and immediately emitted in events.
 *         Storage costs O(1) per file (owner address + timestamp only).
 *         Consumers reconstruct history by scanning indexed events off-chain.
 *
 *         IDENTIFIER INTEGRITY
 *         ─────────────────────
 *         The fileId (bytes32) is computed ON-CHAIN inside `registerFile` using
 *         keccak256(bytes(cid)). Client-provided hashes are NEVER trusted.
 *
 *         FRONT-RUNNING / OVERWRITE PREVENTION
 *         ─────────────────────────────────────
 *         `registerFile` reverts if `files[fileId].owner != address(0)`,
 *         making it impossible to overwrite an existing file registration.
 *
 *         SELF-LOCKOUT PREVENTION
 *         ────────────────────────
 *         `revokeAccess` reverts if `recipient == msg.sender` (the owner).
 *         The owner always retains control via the `onlyFileOwner` modifier.
 *
 *         AUTHORIZATION
 *         ─────────────
 *         `grantAccess` and `revokeAccess` are gated by `onlyFileOwner`,
 *         which verifies `files[fileId].owner == msg.sender`.
 */
contract FileRegistry {

    // ── Storage ───────────────────────────────────────────────────────────────

    /**
     * @dev Minimal on-chain record for a registered file.
     *      CID is NOT stored here; it is emitted in FileRegistered.
     */
    struct FileRecord {
        address owner;
        uint64  createdAt;
    }

    /// @notice Returns the FileRecord for a given fileId.
    mapping(bytes32 => FileRecord) public files;

    /**
     * @notice Returns true if `recipient` has been granted access to `fileId`.
     * @dev    The encrypted key payload itself is NEVER stored here; it is
     *         emitted in AccessGranted and retrieved from event logs off-chain.
     */
    mapping(bytes32 => mapping(address => bool)) public accessPermissions;

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a new file is registered.
     * @param fileId    keccak256(bytes(cid)) — computed on-chain.
     * @param owner     Address that registered the file.
     * @param cid       IPFS CID of the encrypted blob. NOT stored in state.
     * @param timestamp Block timestamp at the time of registration.
     */
    event FileRegistered(
        bytes32 indexed fileId,
        address indexed owner,
        string          cid,
        uint64          timestamp
    );

    /**
     * @notice Emitted when the file owner grants read access to a recipient.
     * @param fileId       The file being shared.
     * @param recipient    Address receiving access.
     * @param encryptedKey The file's AES key encrypted with the recipient's
     *                     public key. NOT stored in state — only in event logs.
     */
    event AccessGranted(
        bytes32 indexed fileId,
        address indexed recipient,
        string          encryptedKey
    );

    /**
     * @notice Emitted when the file owner revokes access from a recipient.
     * @param fileId    The file whose access is being revoked.
     * @param recipient Address losing access.
     */
    event AccessRevoked(
        bytes32 indexed fileId,
        address indexed recipient
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    /// @dev Thrown when `registerFile` is called with a CID that is already registered.
    error FileAlreadyRegistered(bytes32 fileId);

    /// @dev Thrown when `grantAccess` or `revokeAccess` is called by a non-owner.
    error NotFileOwner(bytes32 fileId, address caller);

    /// @dev Thrown when the owner attempts to revoke their own access.
    error CannotRevokeSelf(bytes32 fileId);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    /**
     * @dev Reverts with NotFileOwner if the caller is not the registered owner.
     *      Implicitly also validates that the file exists (owner != address(0)).
     */
    modifier onlyFileOwner(bytes32 fileId) {
        if (files[fileId].owner != msg.sender) {
            revert NotFileOwner(fileId, msg.sender);
        }
        _;
    }

    // ── External Functions ────────────────────────────────────────────────────

    /**
     * @notice Register a new file in the registry.
     *
     * @dev    The fileId is computed on-chain as keccak256(bytes(cid)).
     *         Reverts if the fileId is already registered (existence check on
     *         `files[fileId].owner`) to prevent front-running / overwrites.
     *
     *         The `cid` string is accepted as calldata and emitted in
     *         FileRegistered. It is NOT written to storage.
     *
     * @param  cid  IPFS CID of the AES-256-GCM encrypted file blob.
     * @return fileId  The computed keccak256 identifier for the file.
     */
    function registerFile(string calldata cid)
        external
        returns (bytes32 fileId)
    {
        // 1. Compute identifier on-chain — client-provided hashes are never trusted.
        fileId = keccak256(bytes(cid));

        // 2. Existence check — prevent overwriting or front-running.
        if (files[fileId].owner != address(0)) {
            revert FileAlreadyRegistered(fileId);
        }

        // 3. Write minimal record to storage (no CID stored).
        files[fileId] = FileRecord({
            owner:     msg.sender,
            createdAt: uint64(block.timestamp)
        });

        // 4. Emit CID in event log only — never in storage.
        emit FileRegistered(fileId, msg.sender, cid, uint64(block.timestamp));
    }

    /**
     * @notice Grant a recipient access to a file.
     *
     * @dev    Only the file owner may call this (enforced by `onlyFileOwner`).
     *         The `encryptedKey` (AES key encrypted with recipient's public key)
     *         is accepted as calldata and emitted in AccessGranted.
     *         It is NOT written to storage — zero-knowledge by design.
     *
     * @param fileId        The bytes32 identifier of the file.
     * @param recipient     The address receiving access.
     * @param encryptedKey  The AES key encrypted for the recipient. NOT stored.
     */
    function grantAccess(
        bytes32        fileId,
        address        recipient,
        string calldata encryptedKey
    )
        external
        onlyFileOwner(fileId)
    {
        // Record the permission flag (boolean only — key material not stored).
        accessPermissions[fileId][recipient] = true;

        // Emit the encrypted key payload in the event log.
        emit AccessGranted(fileId, recipient, encryptedKey);
    }

    /**
     * @notice Revoke a recipient's access to a file.
     *
     * @dev    Only the file owner may call this (enforced by `onlyFileOwner`).
     *         Reverts if the owner attempts to revoke their own access to
     *         prevent self-lockout.
     *
     * @param fileId     The bytes32 identifier of the file.
     * @param recipient  The address losing access.
     */
    function revokeAccess(bytes32 fileId, address recipient)
        external
        onlyFileOwner(fileId)
    {
        // Self-lockout prevention: owner cannot revoke their own flag.
        if (recipient == msg.sender) {
            revert CannotRevokeSelf(fileId);
        }

        accessPermissions[fileId][recipient] = false;

        emit AccessRevoked(fileId, recipient);
    }
}

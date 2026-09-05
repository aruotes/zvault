/**
 * FileRegistry.ts — Comprehensive Security & Unit Tests
 * ARUOTES ZVault Phase 3
 *
 * Test matrix (6 required + extended coverage):
 *
 *  ✓ registerFile: correct bytes32 ID + FileRegistered event
 *  ✓ registerFile: duplicate CID → reverts with FileAlreadyRegistered
 *  ✓ grantAccess:  owner grants access → AccessGranted event with key payload
 *  ✓ grantAccess:  non-owner call → reverts with NotFileOwner
 *  ✓ revokeAccess: owner revokes access → AccessRevoked event
 *  ✓ revokeAccess: owner self-revoke → reverts with CannotRevokeSelf
 *
 * Extended:
 *  ✓ registerFile: fileId stored in mapping (owner + timestamp correct)
 *  ✓ grantAccess:  accessPermissions mapping set to true after grant
 *  ✓ revokeAccess: accessPermissions mapping reset to false after revoke
 *  ✓ revokeAccess: third party (not owner) → reverts with NotFileOwner
 */

import { expect }    from 'chai';
import { ethers }    from 'hardhat';
import {
  loadFixture,
}                    from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue }  from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { FileRegistry } from '../typechain-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Deploys a fresh FileRegistry instance.
 * Hardhat's `loadFixture` snapshots the chain state and resets between tests.
 */
async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();

  const FileRegistryFactory = await ethers.getContractFactory('FileRegistry');
  const registry = (await FileRegistryFactory.deploy()) as FileRegistry;
  await registry.waitForDeployment();

  return { registry, owner, alice, bob };
}

/**
 * Deploys and registers a test file.
 * Used by tests that need an existing file record.
 */
async function deployAndRegisterFixture() {
  const base = await deployFixture();
  const { registry, owner } = base;

  const TEST_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const tx       = await registry.connect(owner).registerFile(TEST_CID);
  const receipt  = await tx.wait();
  if (!receipt) throw new Error('Transaction receipt is null');

  // Compute expected fileId off-chain the same way Solidity does
  const expectedFileId = ethers.keccak256(ethers.toUtf8Bytes(TEST_CID));

  return { ...base, TEST_CID, expectedFileId, receipt };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('FileRegistry', () => {

  // ── 1. registerFile ─────────────────────────────────────────────────────────

  describe('registerFile()', () => {

    it('Should compute the correct bytes32 fileId and emit FileRegistered', async () => {
      const { registry, owner } = await loadFixture(deployFixture);

      const CID            = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const expectedFileId = ethers.keccak256(ethers.toUtf8Bytes(CID));

      // The return value from a state-changing tx is not directly accessible via
      // call(); we use .staticCall() to read the return value without mutating state.
      const returnedFileId = await registry.connect(owner).registerFile.staticCall(CID);
      expect(returnedFileId).to.equal(expectedFileId);

      // Now send the actual transaction and check the event.
      await expect(registry.connect(owner).registerFile(CID))
        .to.emit(registry, 'FileRegistered')
        .withArgs(expectedFileId, owner.address, CID, anyValue);
    });

    it('Should store the correct owner address and a non-zero timestamp', async () => {
      const { registry, owner, expectedFileId } = await loadFixture(deployAndRegisterFixture);

      const record = await registry.files(expectedFileId);
      expect(record.owner).to.equal(owner.address);
      expect(record.createdAt).to.be.greaterThan(0n);
    });

    it('Should revert with FileAlreadyRegistered when the same CID is registered twice', async () => {
      const { registry, owner, TEST_CID, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      await expect(registry.connect(owner).registerFile(TEST_CID))
        .to.be.revertedWithCustomError(registry, 'FileAlreadyRegistered')
        .withArgs(expectedFileId);
    });

    it('Should allow a different address to register a different CID', async () => {
      const { registry, alice } = await loadFixture(deployFixture);

      const ALICE_CID = 'bafkreihdwdcefgh4dqkjv67uzcmw37Maya6hX4GXgIBH0aPTH9XlbV2Q';
      const aliceId  = ethers.keccak256(ethers.toUtf8Bytes(ALICE_CID));

      await expect(registry.connect(alice).registerFile(ALICE_CID))
        .to.emit(registry, 'FileRegistered')
        .withArgs(aliceId, alice.address, ALICE_CID, anyValue);
    });

  });

  // ── 2. grantAccess ──────────────────────────────────────────────────────────

  describe('grantAccess()', () => {

    it('Should allow the owner to grant access and emit AccessGranted with the encrypted key', async () => {
      const { registry, owner, alice, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      const ENCRYPTED_KEY = '0xdeadbeef_encrypted_aes_key_for_alice';

      await expect(
        registry.connect(owner).grantAccess(expectedFileId, alice.address, ENCRYPTED_KEY)
      )
        .to.emit(registry, 'AccessGranted')
        .withArgs(expectedFileId, alice.address, ENCRYPTED_KEY);
    });

    it('Should set accessPermissions[fileId][recipient] = true after grant', async () => {
      const { registry, owner, alice, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      expect(await registry.accessPermissions(expectedFileId, alice.address)).to.equal(false);

      await registry.connect(owner).grantAccess(expectedFileId, alice.address, 'enc_key_payload');

      expect(await registry.accessPermissions(expectedFileId, alice.address)).to.equal(true);
    });

    it('Should revert with NotFileOwner when a non-owner calls grantAccess', async () => {
      const { registry, alice, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      await expect(
        registry.connect(alice).grantAccess(expectedFileId, alice.address, 'enc_key')
      )
        .to.be.revertedWithCustomError(registry, 'NotFileOwner')
        .withArgs(expectedFileId, alice.address);
    });

    it('Should revert with NotFileOwner when grantAccess is called for a non-existent file', async () => {
      const { registry, alice } = await loadFixture(deployFixture);

      const nonExistentId = ethers.keccak256(ethers.toUtf8Bytes('does_not_exist'));

      await expect(
        registry.connect(alice).grantAccess(nonExistentId, alice.address, 'enc_key')
      )
        .to.be.revertedWithCustomError(registry, 'NotFileOwner');
    });

  });

  // ── 3. revokeAccess ─────────────────────────────────────────────────────────

  describe('revokeAccess()', () => {

    /**
     * Helper fixture: deploy, register, then grant alice access.
     * Used by revoke tests that need a pre-existing grant.
     */
    async function deployRegisterAndGrantFixture() {
      const base           = await deployAndRegisterFixture();
      const { registry, owner, alice, expectedFileId } = base;

      await registry.connect(owner).grantAccess(expectedFileId, alice.address, 'enc_key_for_alice');

      return base;
    }

    it('Should allow the owner to revoke access and emit AccessRevoked', async () => {
      const { registry, owner, alice, expectedFileId } =
        await loadFixture(deployRegisterAndGrantFixture);

      await expect(registry.connect(owner).revokeAccess(expectedFileId, alice.address))
        .to.emit(registry, 'AccessRevoked')
        .withArgs(expectedFileId, alice.address);
    });

    it('Should set accessPermissions[fileId][recipient] = false after revoke', async () => {
      const { registry, owner, alice, expectedFileId } =
        await loadFixture(deployRegisterAndGrantFixture);

      expect(await registry.accessPermissions(expectedFileId, alice.address)).to.equal(true);

      await registry.connect(owner).revokeAccess(expectedFileId, alice.address);

      expect(await registry.accessPermissions(expectedFileId, alice.address)).to.equal(false);
    });

    it('Should revert with CannotRevokeSelf when the owner attempts to revoke their own access', async () => {
      const { registry, owner, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      await expect(registry.connect(owner).revokeAccess(expectedFileId, owner.address))
        .to.be.revertedWithCustomError(registry, 'CannotRevokeSelf')
        .withArgs(expectedFileId);
    });

    it('Should revert with NotFileOwner when a non-owner calls revokeAccess', async () => {
      const { registry, alice, bob, expectedFileId } =
        await loadFixture(deployRegisterAndGrantFixture);

      await expect(registry.connect(alice).revokeAccess(expectedFileId, bob.address))
        .to.be.revertedWithCustomError(registry, 'NotFileOwner')
        .withArgs(expectedFileId, alice.address);
    });

  });

  // ── 4. Security: Data Minimisation Invariant ─────────────────────────────────

  describe('Security: Data Minimisation', () => {

    it('Should NOT expose cid via the files() mapping (only owner + timestamp stored)', async () => {
      const { registry, expectedFileId } = await loadFixture(deployAndRegisterFixture);

      const record = await registry.files(expectedFileId);

      // The FileRecord struct only has owner + createdAt — no cid field.
      // TypeScript will enforce this: accessing record.cid would be a compile error.
      expect(Object.keys(record.toObject?.() ?? {})).to.not.include('cid');
      // We can only read owner and createdAt from the mapping:
      expect(record.owner).to.not.equal(ethers.ZeroAddress);
      expect(record.createdAt).to.be.greaterThan(0n);
    });

    it('Should NOT expose encryptedKey via the accessPermissions() mapping (only boolean stored)', async () => {
      const { registry, owner, alice, expectedFileId } =
        await loadFixture(deployAndRegisterFixture);

      const SECRET_KEY = 'this_is_a_very_secret_aes_key_encrypted_for_alice';
      await registry.connect(owner).grantAccess(expectedFileId, alice.address, SECRET_KEY);

      // accessPermissions only returns bool — the key is never retrievable from state.
      const permission = await registry.accessPermissions(expectedFileId, alice.address);
      expect(typeof permission).to.equal('boolean');
      expect(permission).to.equal(true);
    });

  });

});

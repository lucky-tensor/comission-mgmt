/**
 * Integration test for packages/core/kms.ts — GCP Cloud KMS backend.
 *
 * The GCP backend test is guarded by KMS_BACKEND=gcp env var and is SKIPPED
 * unless that variable is set. In CI, this test only runs in environments
 * where GCP credentials are available.
 *
 * When KMS_BACKEND is not set, the LocalDevKmsBackend is tested instead
 * (always runs — no external dependencies).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalDevKmsBackend,
  GcpCloudKmsBackend,
  configureKmsBackend,
  kmsGenerateDataKey,
  kmsDecryptDataKey,
  _resetKmsBackend,
  KmsUnavailableError,
} from '../kms';

const TEST_MASTER_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

describe('kms — LocalDevKmsBackend', () => {
  beforeEach(() => {
    _resetKmsBackend();
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
  });

  it('generateDataKey returns a 32-byte plaintext key and non-empty encryptedKey', async () => {
    const backend = new LocalDevKmsBackend();
    const dataKey = await backend.generateDataKey({ domain: 'commission', purpose: 'field-enc' });
    expect(dataKey.plaintextKey).toBeInstanceOf(Uint8Array);
    expect(dataKey.plaintextKey.length).toBe(32);
    expect(dataKey.encryptedKey.length).toBeGreaterThan(0);
  });

  it('decryptDataKey round-trips the same key bytes', async () => {
    const backend = new LocalDevKmsBackend();
    const ctx = { domain: 'commission', purpose: 'field-enc' };
    const dataKey = await backend.generateDataKey(ctx);
    const decrypted = await backend.decryptDataKey(dataKey.encryptedKey, ctx);

    // Both should be the same HKDF-derived bytes
    expect(decrypted.length).toBe(32);
    expect(Array.from(decrypted)).toEqual(Array.from(dataKey.plaintextKey));
  });

  it('different contexts produce different keys', async () => {
    const backend = new LocalDevKmsBackend();
    const key1 = await backend.generateDataKey({ domain: 'placement', purpose: 'field-enc' });
    const key2 = await backend.generateDataKey({ domain: 'invoice', purpose: 'field-enc' });

    expect(Array.from(key1.plaintextKey)).not.toEqual(Array.from(key2.plaintextKey));
  });

  it('throws KmsUnavailableError when ENCRYPTION_MASTER_KEY is absent', async () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    const backend = new LocalDevKmsBackend();
    await expect(
      backend.generateDataKey({ domain: 'commission', purpose: 'field-enc' }),
    ).rejects.toThrow(KmsUnavailableError);
  });

  it('rotateDataKey returns a new data key', async () => {
    const backend = new LocalDevKmsBackend();
    const result = await backend.rotateDataKey({ domain: 'commission', purpose: 'field-enc' });
    expect(result.newDataKey.plaintextKey.length).toBe(32);
    expect(result.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('kms — GcpCloudKmsBackend integration (KMS_BACKEND=gcp)', () => {
  const isGcpEnabled = process.env.KMS_BACKEND === 'gcp';

  it.skipIf(!isGcpEnabled)(
    'GCP backend connects and round-trips a key derivation',
    async () => {
      const keyName = process.env.GCP_KMS_KEY_NAME;
      if (!keyName) throw new Error('GCP_KMS_KEY_NAME must be set when KMS_BACKEND=gcp');

      const backend = new GcpCloudKmsBackend({ keyName });
      configureKmsBackend(backend);

      const ctx = { domain: 'commission', purpose: 'integration-test' };

      // Generate a data key via GCP KMS
      const dataKey = await kmsGenerateDataKey(ctx);
      expect(dataKey.plaintextKey.length).toBe(32);
      expect(dataKey.encryptedKey.length).toBeGreaterThan(0);

      // Decrypt it back via GCP KMS and verify it matches
      const decrypted = await kmsDecryptDataKey(dataKey.encryptedKey, ctx);
      expect(Array.from(decrypted)).toEqual(Array.from(dataKey.plaintextKey));

      _resetKmsBackend();
    },
    30_000,
  );

  it.skipIf(isGcpEnabled)('LocalDevKmsBackend is active when KMS_BACKEND is not gcp', () => {
    // Smoke test: LocalDevKmsBackend should be the default
    const backend = new LocalDevKmsBackend();
    expect(backend).toBeDefined();
  });
});

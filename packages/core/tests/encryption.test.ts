/**
 * Unit tests for packages/core/encryption.ts
 *
 * Tests: encrypt → decrypt round-trip passes; wrong key fails.
 * No database required — uses WebCrypto (available in Bun/Node 18+).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptField,
  decryptField,
  encryptProperties,
  decryptProperties,
  SENSITIVE_FIELDS,
  _resetEncryptionCaches,
} from '../encryption';

const TEST_MASTER_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

function withEncryption(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const original = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
    delete process.env.ENCRYPTION_DISABLED;
    try {
      await fn();
    } finally {
      if (original === undefined) {
        delete process.env.ENCRYPTION_MASTER_KEY;
      } else {
        process.env.ENCRYPTION_MASTER_KEY = original;
      }
    }
  };
}

describe('encryption', () => {
  beforeEach(() => {
    _resetEncryptionCaches();
  });

  afterEach(() => {
    _resetEncryptionCaches();
  });

  it(
    'encrypt → decrypt round-trip passes for placement entity',
    withEncryption(async () => {
      const plaintext = 'test@example.com';
      const ciphertext = await encryptField('placement', plaintext);

      expect(ciphertext).toMatch(/^enc:v1:/);
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = await decryptField('placement', ciphertext);
      expect(decrypted).toBe(plaintext);
    }),
  );

  it(
    'encrypt → decrypt round-trip passes for contributor entity',
    withEncryption(async () => {
      const plaintext = 'Jane Smith';
      const ciphertext = await encryptField('contributor', plaintext);
      const decrypted = await decryptField('contributor', ciphertext);
      expect(decrypted).toBe(plaintext);
    }),
  );

  it(
    'wrong key fails to decrypt',
    withEncryption(async () => {
      const plaintext = 'secret-data';
      const ciphertext = await encryptField('commission', plaintext);

      // Reset caches and switch to a different master key
      _resetEncryptionCaches();
      process.env.ENCRYPTION_MASTER_KEY = 'b'.repeat(64);

      await expect(decryptField('commission', ciphertext)).rejects.toThrow();
    }),
  );

  it(
    'encryptProperties encrypts only sensitive fields',
    withEncryption(async () => {
      const record = {
        candidate_name: 'Alice',
        candidate_email: 'alice@example.com',
        status: 'active', // not sensitive
      };

      const encrypted = await encryptProperties('placement', record);
      expect(encrypted.candidate_name).toMatch(/^enc:v1:/);
      expect(encrypted.candidate_email).toMatch(/^enc:v1:/);
      expect(encrypted.status).toBe('active'); // unchanged

      const decrypted = await decryptProperties('placement', encrypted);
      expect(decrypted.candidate_name).toBe('Alice');
      expect(decrypted.candidate_email).toBe('alice@example.com');
    }),
  );

  it('passes through non-encrypted values when encryption is disabled', async () => {
    process.env.ENCRYPTION_DISABLED = 'true';
    delete process.env.ENCRYPTION_MASTER_KEY;

    const plaintext = 'hello world';
    const result = await encryptField('contributor', plaintext);
    expect(result).toBe(plaintext);

    delete process.env.ENCRYPTION_DISABLED;
  });

  it('passes through values without enc:v1: prefix when decrypting', async () => {
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
    const plaintext = 'not-encrypted';
    const result = await decryptField('invoice', plaintext);
    expect(result).toBe(plaintext);
  });

  it('SENSITIVE_FIELDS covers commission entity types', () => {
    expect(SENSITIVE_FIELDS.placement).toBeDefined();
    expect(SENSITIVE_FIELDS.contributor).toBeDefined();
    expect(SENSITIVE_FIELDS.commission).toBeDefined();
    expect(SENSITIVE_FIELDS.invoice).toBeDefined();
  });
});

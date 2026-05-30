/**
 * Local dev / CI KMS stub.
 *
 * Wraps and unwraps data keys using AES-256-GCM with a master key sourced from
 * DEV_ENCRYPTION_KEY (32-byte hex string, 64 hex chars).
 *
 * THIS IS NOT PRODUCTION-SECURE. It exists so local development and CI can
 * run the full encryption/decryption path without a real KMS service.
 *
 * wrapKey() — encrypts the DEK with the master key using AES-256-GCM.
 * unwrapKey() — decrypts the wrapped DEK.
 *
 * Wrapped DEK format: <12-byte IV> | <ciphertext + 16-byte GCM tag>
 * Total length: 12 + 32 + 16 = 60 bytes.
 */

import { createCipheriv, createDecipheriv } from 'crypto';
import type { IKmsAdapter } from './kms.js';

/**
 * Local dev KMS adapter — AES-256-GCM wrap/unwrap using DEV_ENCRYPTION_KEY.
 * Selected automatically when NODE_ENV !== 'production'.
 */
export class LocalDevKmsAdapter implements IKmsAdapter {
  private masterKey: Buffer | null = null;

  private getMasterKey(): Buffer {
    if (this.masterKey) return this.masterKey;

    const hex = process.env.DEV_ENCRYPTION_KEY;
    if (!hex) {
      // Provide a deterministic test key so tests can run without env config.
      // This is intentionally weak — 32 zero bytes — suitable only for CI.
      this.masterKey = Buffer.alloc(32, 0);
      return this.masterKey;
    }

    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('[kms-dev] DEV_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }

    this.masterKey = Buffer.from(hex, 'hex');
    return this.masterKey;
  }

  async wrapKey(dek: Buffer): Promise<Buffer> {
    const masterKey = this.getMasterKey();
    const iv = Buffer.allocUnsafe(12);
    // Use crypto.getRandomValues via globalThis for Bun/Node compat
    const ivArray = new Uint8Array(12);
    globalThis.crypto.getRandomValues(ivArray);
    ivArray.forEach((b, i) => {
      iv[i] = b;
    });

    const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: IV (12) | ciphertext (32) | GCM tag (16)
    return Buffer.concat([iv, encrypted, tag]);
  }

  async unwrapKey(wrappedDek: Buffer): Promise<Buffer> {
    const masterKey = this.getMasterKey();

    if (wrappedDek.length < 12 + 16) {
      throw new Error('[kms-dev] wrappedDek is too short to be valid');
    }

    const iv = wrappedDek.subarray(0, 12);
    // tag is the last 16 bytes
    const tag = wrappedDek.subarray(wrappedDek.length - 16);
    const ciphertext = wrappedDek.subarray(12, wrappedDek.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Reset cached master key (for test isolation). */
  _resetKey(): void {
    this.masterKey = null;
  }
}

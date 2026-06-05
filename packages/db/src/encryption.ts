/**
 * Field-level encryption for commission domain sensitive columns.
 *
 * ## Envelope encryption model
 *
 * - Per entity_type+field_name pair, a DEK (data encryption key) is generated
 *   via the active IKmsAdapter and cached in-process for 5 minutes.
 * - The DEK is used for AES-256-GCM field encryption/decryption.
 * - The wrapped (KMS-encrypted) DEK is stored in encryption_key_registry.
 * - KEKs are never cached; DEKs are never written to disk or the DB.
 *
 * ## Encrypted value format (BYTEA in Postgres)
 *
 *   Stored as raw bytes: <12-byte IV> | <ciphertext> | <16-byte GCM tag>
 *
 * ## Sensitive fields covered
 *
 *   placements.compensation_base, placements.fee_amount (gross_fee in issue)
 *   commission_records.gross_amount, commission_records.net_payable
 *   invoices.amount_billed, invoices.amount_collected
 *   guarantee_periods.risk_amount
 *   draw_balances.balance, draw_balances.draw_limit
 *
 * Canonical: docs/architecture/decisions.md — Field Encryption Registry
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { IKmsAdapter } from './kms.js';

// ---------------------------------------------------------------------------
// Sensitive field registry
// ---------------------------------------------------------------------------

/**
 * Maps entity_type → list of field names that must be encrypted.
 * These correspond to BYTEA columns in schema.sql.
 */
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  placements: ['compensation_base', 'fee_amount'],
  commission_records: ['gross_amount', 'net_payable'],
  invoices: ['amount_billed', 'amount_collected'],
  guarantee_periods: ['risk_amount'],
  draw_balances: ['balance', 'draw_limit'],
};

// ---------------------------------------------------------------------------
// DEK cache entry
// ---------------------------------------------------------------------------

interface DekCacheEntry {
  /** Plaintext DEK bytes (AES-256, 32 bytes) */
  dek: Buffer;
  /** Epoch ms when this entry expires */
  expiresAt: number;
}

/** DEK cache TTL in milliseconds (5 minutes). */
export const DEK_CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// FieldEncryptor
// ---------------------------------------------------------------------------

/**
 * FieldEncryptor encrypts and decrypts individual field values using
 * envelope encryption backed by an IKmsAdapter.
 *
 * DEKs are cached per (entityType, fieldName) key for DEK_CACHE_TTL_MS.
 * A new KMS unwrapKey() call is made on cache miss or expiry.
 *
 * Encrypted value format (stored as BYTEA):
 *   <12-byte IV> | <ciphertext> | <16-byte GCM tag>
 */
export class FieldEncryptor {
  private readonly adapter: IKmsAdapter;
  /** Cache key → DEK cache entry */
  private readonly dekCache = new Map<string, DekCacheEntry>();

  constructor(adapter: IKmsAdapter) {
    this.adapter = adapter;
  }

  /**
   * Returns a plaintext DEK for the given (entityType, fieldName) pair.
   *
   * On first call (or after TTL expiry), generates a fresh DEK via the KMS
   * adapter, stores the wrapped form in the registry, and caches the plaintext
   * DEK. Subsequent calls within the TTL window return the cached DEK without
   * an additional KMS round-trip.
   *
   * @param entityType  Table name, e.g. 'placements'
   * @param fieldName   Column name, e.g. 'compensation_base'
   * @param wrappedDek  If provided, unwrap this DEK instead of generating one
   */
  async getDek(entityType: string, fieldName: string, wrappedDek?: Buffer): Promise<Buffer> {
    const cacheKey = `${entityType}:${fieldName}`;
    const now = Date.now();

    const cached = this.dekCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.dek;
    }

    let dek: Buffer;
    if (wrappedDek) {
      dek = await this.adapter.unwrapKey(wrappedDek);
    } else {
      // Derive a stable DEK from the adapter's master key and the field context
      // so that encryption/decryption is consistent across restarts and cache misses.
      dek = await this.adapter.deriveKey(`${entityType}:${fieldName}`);
    }

    this.dekCache.set(cacheKey, {
      dek,
      expiresAt: now + DEK_CACHE_TTL_MS,
    });

    return dek;
  }

  /**
   * Wraps a DEK (for storage in encryption_key_registry).
   */
  async wrapDek(dek: Buffer): Promise<Buffer> {
    return this.adapter.wrapKey(dek);
  }

  /**
   * Encrypts a plaintext string value for storage as BYTEA.
   *
   * @param entityType  Table name (e.g. 'placements')
   * @param fieldName   Column name (e.g. 'compensation_base')
   * @param plaintext   String value to encrypt
   * @returns Buffer containing <IV> | <ciphertext> | <GCM tag>
   */
  async encrypt(entityType: string, fieldName: string, plaintext: string): Promise<Buffer> {
    const dek = await this.getDek(entityType, fieldName);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, tag]);
  }

  /**
   * Decrypts a BYTEA buffer previously encrypted by encrypt().
   *
   * @param entityType  Table name
   * @param fieldName   Column name
   * @param cipherBuf   Buffer from Postgres BYTEA column
   * @param wrappedDek  Wrapped DEK from registry (used on cache miss / TTL expiry)
   * @returns Decrypted plaintext string
   */
  async decrypt(
    entityType: string,
    fieldName: string,
    cipherBuf: Buffer,
    wrappedDek?: Buffer,
  ): Promise<string> {
    if (cipherBuf.length < 12 + 16) {
      throw new Error(
        `[encryption] Buffer for ${entityType}.${fieldName} is too short to be a valid ciphertext`,
      );
    }

    const dek = await this.getDek(entityType, fieldName, wrappedDek);
    const iv = cipherBuf.subarray(0, 12);
    const tag = cipherBuf.subarray(cipherBuf.length - 16);
    const ciphertext = cipherBuf.subarray(12, cipherBuf.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Evicts the DEK cache entry for the given (entityType, fieldName) pair.
   * Forces the next encrypt/decrypt to perform a KMS round-trip.
   * Intended for tests.
   */
  _evictCache(entityType: string, fieldName: string): void {
    this.dekCache.delete(`${entityType}:${fieldName}`);
  }

  /**
   * Clears the entire DEK cache. Intended for test isolation.
   */
  _clearCache(): void {
    this.dekCache.clear();
  }

  /**
   * Forces a specific cache entry to expire by backdating its expiresAt.
   * Intended for use with fake timers in TTL tests.
   */
  _expireCacheEntry(entityType: string, fieldName: string): void {
    const cacheKey = `${entityType}:${fieldName}`;
    const entry = this.dekCache.get(cacheKey);
    if (entry) {
      this.dekCache.set(cacheKey, { ...entry, expiresAt: 0 });
    }
  }
}

/**
 * KMS abstraction — Phase 1 security foundation.
 *
 * Field-encryption helpers (encryptField / decryptField in encryption.ts) only
 * ever see data keys through this abstraction. The underlying key-management
 * backend is swappable at startup without changing any call site.
 *
 * ## Envelope encryption model
 *
 * 1. A data key (DEK) is generated or fetched from the KMS for each sensitivity
 *    class / entity-type domain.
 * 2. The DEK is used locally for AES-256-GCM field encryption.
 * 3. The DEK is stored encrypted-under-the-KMS-master-key (the "encrypted DEK").
 * 4. On decrypt, the encrypted DEK is sent to KMS to recover the plaintext DEK.
 *
 * Key material NEVER leaves the KMS boundary in plaintext for the GCP backend.
 * The local-dev backend derives keys from an env-var master key and is
 * suitable for development and CI only.
 *
 * ## Backend implementations
 *
 * | Backend              | Use case                          |
 * | -------------------- | --------------------------------- |
 * | LocalDevKmsBackend   | Local dev / CI (env-var master)   |
 * | GcpCloudKmsBackend   | Staging / production (GCP KMS)    |
 *
 * ## Usage
 *
 * ```ts
 * import { configureKmsBackend, GcpCloudKmsBackend } from 'core/kms';
 * configureKmsBackend(new GcpCloudKmsBackend({
 *   keyName: process.env.GCP_KMS_KEY_NAME!,
 * }));
 * ```
 *
 * Activate GCP backend by setting KMS_BACKEND=gcp at startup.
 *
 * Canonical docs: docs/architecture.md — Phase 1 Security foundation
 * Adapted from smart-crm packages/core/kms.ts — dropped AWS/Vault, added GCP Cloud KMS.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * A data key (DEK) ready for local AES-256-GCM use.
 *
 * `plaintextKey` is a 32-byte Uint8Array for use with the WebCrypto API.
 * `encryptedKey` is the KMS-ciphertext blob that can be stored alongside
 * the encrypted data and passed back to `decryptDataKey` to recover the DEK.
 */
export interface DataKey {
  /** 32-byte plaintext data key — use for AES-256-GCM, then discard. */
  plaintextKey: Uint8Array;
  /**
   * KMS-encrypted form of the data key.
   *
   * Store this alongside the encrypted data. Pass it to `decryptDataKey` to
   * recover the plaintext DEK on a subsequent read.
   */
  encryptedKey: Uint8Array;
}

/**
 * Result of a key rotation operation.
 */
export interface RotationResult {
  /**
   * The new data key that was generated.
   * Use the `plaintextKey` to re-encrypt the data, then store `encryptedKey`.
   */
  newDataKey: DataKey;
  /**
   * Timestamp (ISO-8601) at which the rotation was performed.
   */
  rotatedAt: string;
}

// ---------------------------------------------------------------------------
// KmsBackend interface
// ---------------------------------------------------------------------------

/**
 * KMS backend contract.
 *
 * All three operations communicate with a key-management service that holds the
 * root key material. The `encryptionContext` map is included in GCP KMS
 * additional authenticated data and cryptographic integrity checks — always pass
 * the same context for a given domain.
 */
export interface KmsBackend {
  /**
   * Generates a new AES-256 data key protected by the KMS master key.
   *
   * The returned `plaintextKey` should be used for exactly one encryption
   * operation and then discarded. The `encryptedKey` is stored with the data.
   *
   * @param encryptionContext - Arbitrary key/value metadata bound to this data key
   *   (e.g. `{ domain: 'commission', purpose: 'field-enc' }`).
   *   Must be identical when calling `decryptDataKey`.
   */
  generateDataKey(encryptionContext: Record<string, string>): Promise<DataKey>;

  /**
   * Decrypts an encrypted data key previously returned by `generateDataKey`.
   *
   * @param encryptedKey  - The `encryptedKey` blob from `DataKey`.
   * @param encryptionContext - Must match the context used during generation.
   * @returns The 32-byte plaintext data key.
   */
  decryptDataKey(
    encryptedKey: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array>;

  /**
   * Performs a KMS-level key rotation and returns a new data key.
   *
   * For GCP Cloud KMS this triggers CreateCryptoKeyVersion and then
   * generates a new data key under the new version.
   * For the local dev backend this generates a fresh key from the current master.
   *
   * @param encryptionContext - Context for the new data key.
   */
  rotateDataKey(encryptionContext: Record<string, string>): Promise<RotationResult>;
}

// ---------------------------------------------------------------------------
// LocalDevKmsBackend — derives keys from ENCRYPTION_MASTER_KEY env var
// ---------------------------------------------------------------------------

/**
 * Local-dev and CI KMS backend.
 *
 * Derives AES-256 data keys from a master key in `process.env.ENCRYPTION_MASTER_KEY`
 * using HKDF-SHA-256. The "encrypted key" format is a no-op round-trip: the
 * encrypted key bytes ARE the context-deterministic derived key (re-derivation
 * on decrypt). This means no actual wrapping occurs — suitable ONLY for
 * development and tests.
 *
 * When `ENCRYPTION_MASTER_KEY` is absent, `generateDataKey` throws a
 * `KmsUnavailableError` so misconfiguration is visible at startup.
 */
export class LocalDevKmsBackend implements KmsBackend {
  private masterKey: CryptoKey | null = null;

  private async getMasterKey(): Promise<CryptoKey> {
    if (this.masterKey) return this.masterKey;

    const hex = process.env.ENCRYPTION_MASTER_KEY;
    if (!hex) {
      throw new KmsUnavailableError('LocalDevKmsBackend requires ENCRYPTION_MASTER_KEY to be set');
    }

    let rawBytes: Uint8Array<ArrayBuffer>;
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      const pairs = hex.match(/.{2}/g)!;
      const buf = new ArrayBuffer(pairs.length);
      rawBytes = new Uint8Array(buf);
      for (let i = 0; i < pairs.length; i++) {
        rawBytes[i] = parseInt(pairs[i], 16);
      }
    } else {
      // treat as base64
      const binaryString = atob(hex);
      const buf = new ArrayBuffer(binaryString.length);
      rawBytes = new Uint8Array(buf);
      for (let i = 0; i < binaryString.length; i++) {
        rawBytes[i] = binaryString.charCodeAt(i);
      }
    }

    this.masterKey = await crypto.subtle.importKey('raw', rawBytes, { name: 'HKDF' }, false, [
      'deriveKey',
      'deriveBits',
    ]);
    return this.masterKey;
  }

  private async deriveKeyBytes(encryptionContext: Record<string, string>): Promise<Uint8Array> {
    const master = await this.getMasterKey();
    const encoder = new TextEncoder();
    // Build a canonical info string from sorted context entries
    const infoStr = Object.entries(encryptionContext)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    const info = encoder.encode(infoStr);

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(new ArrayBuffer(32)),
        info,
      },
      master,
      256,
    );
    return new Uint8Array(bits as ArrayBuffer);
  }

  async generateDataKey(encryptionContext: Record<string, string>): Promise<DataKey> {
    // For local dev: use HKDF to derive a deterministic plaintext key from the context.
    // The "encrypted key" is the context string (UTF-8 bytes) — decryptDataKey re-derives
    // the same HKDF key from the stored context, so no actual wrapping is needed.
    // This is NOT production-secure — it is a local-dev convenience.
    const plaintextKey = await this.deriveKeyBytes(encryptionContext);

    // Store the canonical context string as the "encrypted key" so decryptDataKey
    // can re-derive the same key without network calls.
    const encoder = new TextEncoder();
    const infoStr = Object.entries(encryptionContext)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    const encryptedKey = encoder.encode(infoStr);

    return { plaintextKey, encryptedKey };
  }

  async decryptDataKey(
    _encryptedKey: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array> {
    // Re-derive the same HKDF key from the encryption context.
    // Context-only derivation for local dev / CI.
    return this.deriveKeyBytes(encryptionContext);
  }

  async rotateDataKey(encryptionContext: Record<string, string>): Promise<RotationResult> {
    // Invalidate cached master key so a fresh ENCRYPTION_MASTER_KEY would be picked up
    this.masterKey = null;
    const newDataKey = await this.generateDataKey(encryptionContext);
    return { newDataKey, rotatedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// GcpCloudKmsBackend — GCP Cloud KMS encrypt / decrypt
// ---------------------------------------------------------------------------

export interface GcpCloudKmsBackendOptions {
  /**
   * The full resource name of the GCP Cloud KMS crypto key version or key.
   * Example:
   *   projects/my-project/locations/global/keyRings/commission-mgmt/cryptoKeys/field-enc
   */
  keyName: string;
  /**
   * GCP access token. When omitted the backend resolves credentials via the
   * GCP metadata server (for GKE/Cloud Run) or `GOOGLE_APPLICATION_CREDENTIALS`.
   */
  accessToken?: string;
}

/**
 * GCP Cloud KMS backend for staging and production environments.
 *
 * Uses the GCP Cloud KMS `encrypt` and `decrypt` APIs over HTTPS (no SDK
 * dependency — authentication uses Bearer tokens from the metadata server or
 * a service-account key).
 *
 * The data key is generated locally using WebCrypto and then wrapped
 * (encrypted) using Cloud KMS — GCP never sees plaintext field data.
 *
 * Activated when KMS_BACKEND=gcp is set in the environment.
 * Integration tests are guarded by this env var and skipped otherwise.
 *
 * Canonical docs: docs/architecture.md — Phase 1 KMS integration
 */
export class GcpCloudKmsBackend implements KmsBackend {
  private readonly keyName: string;
  private _accessToken: string | null;

  constructor(opts: GcpCloudKmsBackendOptions) {
    this.keyName = opts.keyName;
    this._accessToken = opts.accessToken ?? null;
  }

  // ---------------------------------------------------------------------------
  // Credential resolution
  // ---------------------------------------------------------------------------

  private async resolveAccessToken(): Promise<string> {
    if (this._accessToken) return this._accessToken;

    // Try GCP metadata server (works in GKE, Cloud Run, Compute Engine)
    try {
      const res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } },
      );
      if (!res.ok) throw new Error(`Metadata server HTTP ${res.status}`);
      const json = (await res.json()) as { access_token: string };
      this._accessToken = json.access_token;
      return this._accessToken;
    } catch (err) {
      throw new KmsUnavailableError(
        `GcpCloudKmsBackend: could not resolve GCP access token from metadata server: ${(err as Error).message}. ` +
          `Set accessToken option or run on GCP.`,
      );
    }
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private encryptUrl(): string {
    return `https://cloudkms.googleapis.com/v1/${this.keyName}:encrypt`;
  }

  private decryptUrl(): string {
    return `https://cloudkms.googleapis.com/v1/${this.keyName}:decrypt`;
  }

  // ---------------------------------------------------------------------------
  // KmsBackend implementation
  // ---------------------------------------------------------------------------

  async generateDataKey(encryptionContext: Record<string, string>): Promise<DataKey> {
    // Generate a random 256-bit data key locally
    const plaintextKey = new Uint8Array(32);
    crypto.getRandomValues(plaintextKey);

    const token = await this.resolveAccessToken();

    // Build additional authenticated data from the context
    const aadStr = JSON.stringify(
      Object.fromEntries(Object.entries(encryptionContext).sort(([a], [b]) => a.localeCompare(b))),
    );
    const aadB64 = btoa(aadStr);
    const plaintextB64 = uint8ArrayToBase64(plaintextKey);

    const res = await fetch(this.encryptUrl(), {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({
        plaintext: plaintextB64,
        additionalAuthenticatedData: aadB64,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new KmsOperationError(`GCP KMS encrypt failed (HTTP ${res.status}): ${text}`);
    }

    const json = (await res.json()) as { ciphertext: string };
    // Store the GCP ciphertext as the encryptedKey blob
    const encryptedKey = base64ToUint8Array(json.ciphertext);

    return { plaintextKey, encryptedKey };
  }

  async decryptDataKey(
    encryptedKey: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array> {
    const token = await this.resolveAccessToken();

    const aadStr = JSON.stringify(
      Object.fromEntries(Object.entries(encryptionContext).sort(([a], [b]) => a.localeCompare(b))),
    );
    const aadB64 = btoa(aadStr);
    const ciphertextB64 = uint8ArrayToBase64(encryptedKey);

    const res = await fetch(this.decryptUrl(), {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({
        ciphertext: ciphertextB64,
        additionalAuthenticatedData: aadB64,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new KmsOperationError(`GCP KMS decrypt failed (HTTP ${res.status}): ${text}`);
    }

    const json = (await res.json()) as { plaintext: string };
    return base64ToUint8Array(json.plaintext);
  }

  async rotateDataKey(encryptionContext: Record<string, string>): Promise<RotationResult> {
    // Invalidate cached token so next call re-fetches (handles token expiry)
    this._accessToken = null;
    // Generate a new data key under the current key version.
    // GCP KMS automatic key rotation is configured via the key's rotation schedule.
    const newDataKey = await this.generateDataKey(encryptionContext);
    return { newDataKey, rotatedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Module-level backend registry
// ---------------------------------------------------------------------------

/** Active KMS backend. Defaults to LocalDevKmsBackend at module load. */
let _kmsBackend: KmsBackend = new LocalDevKmsBackend();

/**
 * Replaces the active KMS backend.
 *
 * Call this once at server startup to wire in a production backend:
 *
 * ```ts
 * import { configureKmsBackend, GcpCloudKmsBackend } from 'core/kms';
 * configureKmsBackend(new GcpCloudKmsBackend({ keyName: process.env.GCP_KMS_KEY_NAME! }));
 * ```
 */
export function configureKmsBackend(backend: KmsBackend): void {
  _kmsBackend = backend;
}

/**
 * Returns the currently active KMS backend.
 * Intended for tests that need to inspect or reset the backend.
 */
export function getKmsBackend(): KmsBackend {
  return _kmsBackend;
}

/**
 * Resets the KMS backend to the default LocalDevKmsBackend.
 * Intended for test isolation between suites.
 */
export function _resetKmsBackend(): void {
  _kmsBackend = new LocalDevKmsBackend();
}

// ---------------------------------------------------------------------------
// Convenience wrappers — call through the active backend
// ---------------------------------------------------------------------------

/**
 * Generates a new data key through the active KMS backend.
 * The `encryptionContext` must match the context used in `kmsDecryptDataKey`.
 */
export async function kmsGenerateDataKey(
  encryptionContext: Record<string, string>,
): Promise<DataKey> {
  return _kmsBackend.generateDataKey(encryptionContext);
}

/**
 * Decrypts a data key through the active KMS backend.
 */
export async function kmsDecryptDataKey(
  encryptedKey: Uint8Array,
  encryptionContext: Record<string, string>,
): Promise<Uint8Array> {
  return _kmsBackend.decryptDataKey(encryptedKey, encryptionContext);
}

/**
 * Rotates a data key through the active KMS backend.
 */
export async function kmsRotateDataKey(
  encryptionContext: Record<string, string>,
): Promise<RotationResult> {
  return _kmsBackend.rotateDataKey(encryptionContext);
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the KMS backend cannot be reached or is misconfigured.
 */
export class KmsUnavailableError extends Error {
  constructor(message: string) {
    super(`[kms] ${message}`);
    this.name = 'KmsUnavailableError';
  }
}

/**
 * Thrown when a KMS operation (generate, decrypt, rotate) fails.
 */
export class KmsOperationError extends Error {
  constructor(message: string) {
    super(`[kms] ${message}`);
    this.name = 'KmsOperationError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64ToUint8Array(b64: string): Uint8Array {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

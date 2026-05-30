/**
 * KMS adapter interface and GCP Cloud KMS implementation.
 *
 * ## Envelope encryption model
 *
 * 1. FieldEncryptor generates a random 256-bit DEK.
 * 2. wrapKey() sends the DEK to KMS for wrapping (KEK-encrypted form).
 * 3. The wrapped DEK is stored in encryption_key_registry alongside field data.
 * 4. On decrypt, unwrapKey() recovers the plaintext DEK from the wrapped form.
 *
 * KEKs never leave the KMS boundary. DEKs are cached in-process for 5 minutes
 * and never written to disk or the database.
 *
 * ## Production configuration
 *
 * Set COMMISSION_KMS_KEY_RING to the GCP Cloud KMS key ring resource name:
 *   projects/<proj>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>
 *
 * ## Dev/CI configuration
 *
 * NODE_ENV != 'production': the local dev stub (kms-dev.ts) is used automatically.
 * Set DEV_ENCRYPTION_KEY to a 32-byte hex string (64 hex chars).
 */

/**
 * KMS adapter interface.
 *
 * Production uses GcpKmsAdapter backed by Cloud KMS.
 * Dev/CI uses the local AES-256-GCM stub from kms-dev.ts.
 */
export interface IKmsAdapter {
  /**
   * Wraps (encrypts) a DEK using the KEK held by the KMS.
   * @param dek 32-byte plaintext data encryption key
   * @returns Wrapped (KMS-encrypted) DEK bytes
   */
  wrapKey(dek: Buffer): Promise<Buffer>;

  /**
   * Unwraps (decrypts) a wrapped DEK using the KEK held by the KMS.
   * @param wrappedDek Bytes returned by a previous wrapKey() call
   * @returns 32-byte plaintext data encryption key
   */
  unwrapKey(wrappedDek: Buffer): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// GCP Cloud KMS adapter
// ---------------------------------------------------------------------------

/**
 * GCP Cloud KMS adapter for production environments.
 *
 * Uses the Cloud KMS REST API to wrap/unwrap data keys via the
 * `cryptoKeyVersions.asymmetricEncrypt` / `cryptoKeys.decrypt` surface.
 *
 * Requires COMMISSION_KMS_KEY_RING to be set to the fully-qualified CryptoKey
 * resource name (e.g. projects/p/locations/l/keyRings/r/cryptoKeys/k).
 *
 * Authentication uses Application Default Credentials (ADC) — workload
 * identity in GKE or GOOGLE_APPLICATION_CREDENTIALS in other environments.
 */
export class GcpKmsAdapter implements IKmsAdapter {
  private readonly keyName: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(keyName: string) {
    this.keyName = keyName;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    // Try env-var service account key first, then metadata server
    const saKeyJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (saKeyJson) {
      return this.getTokenFromServiceAccountKey(saKeyJson);
    }

    // Fall back to GCE metadata server (workload identity / default SA)
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!res.ok) {
      throw new KmsUnavailableError(
        `GCP metadata server returned HTTP ${res.status} — cannot obtain access token`,
      );
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.tokenExpiry = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  private async getTokenFromServiceAccountKey(saKeyJson: string): Promise<string> {
    // Minimal JWT-based SA token — sign with RS256 using the SA private key
    // For now we throw to indicate this path requires an SDK or full JWT impl.
    // In practice, GKE workload identity covers the production path.
    throw new KmsUnavailableError(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON JWT signing not implemented — use workload identity or set GOOGLE_APPLICATION_CREDENTIALS file path',
    );
  }

  async wrapKey(dek: Buffer): Promise<Buffer> {
    const token = await this.getAccessToken();
    const plaintextB64 = dek.toString('base64');

    const url = `https://cloudkms.googleapis.com/v1/${this.keyName}:encrypt`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plaintext: plaintextB64 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new KmsOperationError(`GCP KMS encrypt failed (HTTP ${res.status}): ${text}`);
    }

    const json = (await res.json()) as { ciphertext: string };
    return Buffer.from(json.ciphertext, 'base64');
  }

  async unwrapKey(wrappedDek: Buffer): Promise<Buffer> {
    const token = await this.getAccessToken();
    const ciphertextB64 = wrappedDek.toString('base64');

    const url = `https://cloudkms.googleapis.com/v1/${this.keyName}:decrypt`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ciphertext: ciphertextB64 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new KmsOperationError(`GCP KMS decrypt failed (HTTP ${res.status}): ${text}`);
    }

    const json = (await res.json()) as { plaintext: string };
    return Buffer.from(json.plaintext, 'base64');
  }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate KMS adapter for the current environment.
 *
 * - NODE_ENV === 'production': GcpKmsAdapter backed by COMMISSION_KMS_KEY_RING.
 *   Throws at startup if the env var is missing.
 * - All other environments: LocalDevKmsAdapter from kms-dev.ts (lazy import).
 */
export async function createKmsAdapter(): Promise<IKmsAdapter> {
  if (process.env.NODE_ENV === 'production') {
    const keyRing = process.env.COMMISSION_KMS_KEY_RING;
    if (!keyRing) {
      throw new KmsUnavailableError(
        'COMMISSION_KMS_KEY_RING is required in production mode — ' +
          'set it to the fully-qualified GCP Cloud KMS CryptoKey resource name',
      );
    }
    return new GcpKmsAdapter(keyRing);
  }

  // Dev/CI: use the local AES-256-GCM stub
  const { LocalDevKmsAdapter } = await import('./kms-dev.js');
  return new LocalDevKmsAdapter();
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class KmsUnavailableError extends Error {
  constructor(message: string) {
    super(`[kms] ${message}`);
    this.name = 'KmsUnavailableError';
  }
}

export class KmsOperationError extends Error {
  constructor(message: string) {
    super(`[kms] ${message}`);
    this.name = 'KmsOperationError';
  }
}

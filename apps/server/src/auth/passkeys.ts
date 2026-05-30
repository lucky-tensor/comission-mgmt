/**
 * WebAuthn/FIDO2 passkey registration and assertion logic.
 *
 * This module implements a minimal but correct WebAuthn server using the
 * WebCrypto API and manual CBOR/COSE parsing to avoid external WebAuthn
 * library dependencies. It covers:
 *
 *   - Registration: challenge generation → authenticator response verification
 *     → credential storage
 *   - Assertion: challenge generation → authenticator assertion verification
 *     → session issuance
 *
 * Reference: https://www.w3.org/TR/webauthn-2/
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation, WebAuthn Auth
 * Issue: feat: authentication, multi-tenant isolation, and RBAC for six roles
 */

import {
  createChallenge,
  consumeChallenge,
  createUser,
  getUserByEmail,
  getPasskeyCredential,
  createPasskeyCredential,
  updatePasskeySignCount,
  getPasskeyCredentialsForUser,
} from 'db/passkeys';

// ---------------------------------------------------------------------------
// Base64URL helpers (shared with jwt.ts but reproduced here to avoid import cycles)
// ---------------------------------------------------------------------------

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const ab = new ArrayBuffer(binary.length);
  const buf = new Uint8Array(ab);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Minimal CBOR decoder (subset needed for WebAuthn authenticator data + COSE)
// ---------------------------------------------------------------------------

/**
 * Decodes a minimal subset of CBOR required by WebAuthn:
 *   - Unsigned integers (major type 0)
 *   - Byte strings (major type 2)
 *   - Text strings (major type 3)
 *   - Arrays (major type 4)
 *   - Maps (major type 5)
 *   - Negative integers (major type 1)
 */
function cborDecode(data: Uint8Array, offset = 0): { value: unknown; offset: number } {
  const first = data[offset++];
  const majorType = first >> 5;
  const additionalInfo = first & 0x1f;

  let length: number;

  if (additionalInfo < 24) {
    length = additionalInfo;
  } else if (additionalInfo === 24) {
    length = data[offset++];
  } else if (additionalInfo === 25) {
    length = (data[offset++] << 8) | data[offset++];
  } else if (additionalInfo === 26) {
    length =
      ((data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]) >>>
      0;
  } else {
    throw new Error(`CBOR: unsupported additional info ${additionalInfo}`);
  }

  switch (majorType) {
    case 0: // unsigned integer
      return { value: length, offset };
    case 1: // negative integer
      return { value: -1 - length, offset };
    case 2: {
      // byte string
      const bytes = data.slice(offset, offset + length);
      return { value: bytes, offset: offset + length };
    }
    case 3: {
      // text string
      const text = new TextDecoder().decode(data.slice(offset, offset + length));
      return { value: text, offset: offset + length };
    }
    case 4: {
      // array
      const arr: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const item = cborDecode(data, offset);
        arr.push(item.value);
        offset = item.offset;
      }
      return { value: arr, offset };
    }
    case 5: {
      // map
      const map: Record<string | number, unknown> = {};
      for (let i = 0; i < length; i++) {
        const key = cborDecode(data, offset);
        offset = key.offset;
        const val = cborDecode(data, offset);
        offset = val.offset;
        map[key.value as string | number] = val.value;
      }
      return { value: map, offset };
    }
    default:
      throw new Error(`CBOR: unsupported major type ${majorType}`);
  }
}

// ---------------------------------------------------------------------------
// COSE key parsing
// ---------------------------------------------------------------------------

interface CosePublicKey {
  kty: number;
  alg: number;
  crv?: number;
  x?: Uint8Array;
  y?: Uint8Array;
  n?: Uint8Array;
  e?: Uint8Array;
}

function parseCoseKey(data: Uint8Array): CosePublicKey {
  const { value } = cborDecode(data);
  const map = value as Record<number, unknown>;
  return {
    kty: map[1] as number,
    alg: map[3] as number,
    crv: map[-1] as number | undefined,
    x: map[-2] as Uint8Array | undefined,
    y: map[-3] as Uint8Array | undefined,
    n: map[-1] as Uint8Array | undefined,
    e: map[-2] as Uint8Array | undefined,
  };
}

/**
 * Imports a COSE-encoded public key as a WebCrypto CryptoKey.
 * Supports EC2 (P-256, alg -7) and RSA (alg -257) key types.
 */
async function importCosePublicKey(coseBytes: Uint8Array): Promise<CryptoKey> {
  const cose = parseCoseKey(coseBytes);

  // EC2 key (kty=2, alg=-7 = ES256, crv=1 = P-256)
  if (cose.kty === 2 && cose.alg === -7) {
    if (!cose.x || !cose.y) throw new Error('COSE EC2 key missing x or y');
    const jwk: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(cose.x),
      y: base64UrlEncode(cose.y),
    };
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'verify',
    ]);
  }

  // RSA key (kty=3, alg=-257 = RS256)
  if (cose.kty === 3 && cose.alg === -257) {
    if (!cose.n || !cose.e) throw new Error('COSE RSA key missing n or e');
    const jwk: JsonWebKey = {
      kty: 'RSA',
      alg: 'RS256',
      n: base64UrlEncode(cose.n),
      e: base64UrlEncode(cose.e),
    };
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    );
  }

  throw new Error(`COSE: unsupported key type kty=${cose.kty} alg=${cose.alg}`);
}

// ---------------------------------------------------------------------------
// Authenticator data parsing
// ---------------------------------------------------------------------------

interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attestedCredentialData?: {
    aaguid: Uint8Array;
    credentialId: Uint8Array;
    credentialPublicKey: Uint8Array;
  };
}

const FLAG_UP = 0x01; // User Presence
// FLAG_UV (0x04) = User Verification — available for stricter checks if needed
const FLAG_AT = 0x40; // Attested Credential Data present

function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
  if (data.length < 37) throw new Error('AuthenticatorData too short');

  const rpIdHash = data.slice(0, 32);
  const flags = data[32];
  const signCount = (data[33] << 24) | (data[34] << 16) | (data[35] << 8) | data[36];

  let attestedCredentialData: AuthenticatorData['attestedCredentialData'] | undefined;

  if (flags & FLAG_AT) {
    let offset = 37;
    const aaguid = data.slice(offset, offset + 16);
    offset += 16;

    const credIdLen = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    const credentialId = data.slice(offset, offset + credIdLen);
    offset += credIdLen;

    // The rest is the COSE credential public key
    const credentialPublicKey = data.slice(offset);

    attestedCredentialData = { aaguid, credentialId, credentialPublicKey };
  }

  return { rpIdHash, flags, signCount, attestedCredentialData };
}

// ---------------------------------------------------------------------------
// RP (Relying Party) configuration
// ---------------------------------------------------------------------------

function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID ?? 'localhost';
}

function getRpName(): string {
  return process.env.WEBAUTHN_RP_NAME ?? 'Commission Management';
}

function getOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:31415';
}

// ---------------------------------------------------------------------------
// Registration flow
// ---------------------------------------------------------------------------

export interface RegisterBeginResult {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: string;
  authenticatorSelection: {
    authenticatorAttachment?: string;
    requireResidentKey: boolean;
    residentKey: string;
    userVerification: string;
  };
}

/**
 * Begins a WebAuthn passkey registration flow.
 * Creates or retrieves the user record, generates a challenge, and returns
 * the PublicKeyCredentialCreationOptions for the client.
 */
export async function passkeyRegisterBegin(opts: {
  email: string;
  displayName?: string;
}): Promise<RegisterBeginResult> {
  // Create or retrieve the user
  let user = await getUserByEmail(opts.email);
  if (!user) {
    user = await createUser(opts.email, opts.displayName);
  }

  const challenge = base64UrlEncode(
    new Uint8Array(
      (() => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return bytes;
      })(),
    ),
  );

  await createChallenge(challenge, 'registration', user.id);

  return {
    challenge,
    rp: { id: getRpId(), name: getRpName() },
    user: {
      id: base64UrlEncode(new TextEncoder().encode(user.id)),
      name: user.email,
      displayName: user.displayName ?? user.email,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      requireResidentKey: true,
      residentKey: 'required',
      userVerification: 'required',
    },
  };
}

/**
 * Completes a WebAuthn passkey registration flow.
 * Verifies the authenticator response and stores the credential.
 */
export async function passkeyRegisterComplete(opts: {
  challenge: string;
  clientDataJSON: string; // base64url
  attestationObject: string; // base64url
  transports?: string[];
}): Promise<{ credentialId: string; userId: string }> {
  // 1. Verify and consume the challenge
  const storedChallenge = await consumeChallenge(opts.challenge, 'registration');
  if (!storedChallenge) throw new Error('Invalid or expired challenge');
  const userId = storedChallenge.userId;
  if (!userId) throw new Error('Challenge has no associated user');

  // 2. Decode and verify clientDataJSON
  const clientDataBytes = base64UrlDecode(opts.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientData.type !== 'webauthn.create') {
    throw new Error('clientData.type must be webauthn.create');
  }
  if (clientData.challenge !== opts.challenge) {
    throw new Error('Challenge mismatch');
  }
  if (clientData.origin !== getOrigin()) {
    throw new Error(`Origin mismatch: expected ${getOrigin()}, got ${clientData.origin}`);
  }

  // 3. Decode the attestation object (CBOR)
  const attObjBytes = base64UrlDecode(opts.attestationObject);
  const { value: attObj } = cborDecode(attObjBytes);
  const attObjMap = attObj as Record<string, unknown>;

  const authDataBytes = attObjMap['authData'] as Uint8Array;
  if (!authDataBytes) throw new Error('Missing authData in attestation object');

  // 4. Parse authenticator data
  const authData = parseAuthenticatorData(authDataBytes);

  // 5. Verify RP ID hash
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpId())),
  );
  if (!expectedRpIdHash.every((b, i) => b === authData.rpIdHash[i])) {
    throw new Error('RP ID hash mismatch');
  }

  // 6. Verify user presence flag
  if (!(authData.flags & FLAG_UP)) {
    throw new Error('User Presence flag not set');
  }

  // 7. Extract credential data
  const attest = authData.attestedCredentialData;
  if (!attest) throw new Error('No attested credential data in authenticator data');

  const credentialId = base64UrlEncode(attest.credentialId);

  // 8. Store the credential
  await createPasskeyCredential({
    userId,
    credentialId,
    publicKey: attest.credentialPublicKey,
    signCount: authData.signCount,
    transports: opts.transports,
  });

  return { credentialId, userId };
}

// ---------------------------------------------------------------------------
// Assertion flow
// ---------------------------------------------------------------------------

export interface AssertBeginResult {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials?: { type: 'public-key'; id: string; transports?: string[] }[];
}

/**
 * Begins a WebAuthn passkey assertion (login) flow.
 * Generates a challenge and returns the PublicKeyCredentialRequestOptions.
 */
export async function passkeyLoginBegin(opts: { email?: string }): Promise<AssertBeginResult> {
  const challenge = base64UrlEncode(
    (() => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return bytes;
    })(),
  );

  await createChallenge(challenge, 'assertion');

  const result: AssertBeginResult = {
    challenge,
    rpId: getRpId(),
    timeout: 60000,
    userVerification: 'required',
  };

  // If email provided, include allowCredentials for UX (optional)
  if (opts.email) {
    const user = await getUserByEmail(opts.email);
    if (user) {
      const creds = await getPasskeyCredentialsForUser(user.id);
      result.allowCredentials = creds.map((c) => ({
        type: 'public-key' as const,
        id: c.credentialId,
        transports: c.transports ?? undefined,
      }));
    }
  }

  return result;
}

export interface AssertCompleteResult {
  userId: string;
  credentialId: string;
}

/**
 * Completes a WebAuthn passkey assertion (login) flow.
 * Verifies the authenticator assertion and returns the authenticated user ID.
 */
export async function passkeyLoginComplete(opts: {
  challenge: string;
  credentialId: string;
  clientDataJSON: string; // base64url
  authenticatorData: string; // base64url
  signature: string; // base64url
  userHandle?: string; // base64url
}): Promise<AssertCompleteResult> {
  // 1. Verify and consume the challenge
  const storedChallenge = await consumeChallenge(opts.challenge, 'assertion');
  if (!storedChallenge) throw new Error('Invalid or expired challenge');

  // 2. Look up the credential
  const cred = await getPasskeyCredential(opts.credentialId);
  if (!cred) throw new Error('Unknown credential ID');

  // 3. Decode and verify clientDataJSON
  const clientDataBytes = base64UrlDecode(opts.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientData.type !== 'webauthn.get') {
    throw new Error('clientData.type must be webauthn.get');
  }
  if (clientData.challenge !== opts.challenge) {
    throw new Error('Challenge mismatch');
  }
  if (clientData.origin !== getOrigin()) {
    throw new Error(`Origin mismatch: expected ${getOrigin()}, got ${clientData.origin}`);
  }

  // 4. Parse authenticator data
  const authDataBytes = base64UrlDecode(opts.authenticatorData);
  const authData = parseAuthenticatorData(authDataBytes);

  // 5. Verify RP ID hash
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpId())),
  );
  if (!expectedRpIdHash.every((b, i) => b === authData.rpIdHash[i])) {
    throw new Error('RP ID hash mismatch');
  }

  // 6. Verify user presence
  if (!(authData.flags & FLAG_UP)) {
    throw new Error('User Presence flag not set');
  }

  // 7. Verify signature
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
  signedData.set(authDataBytes);
  signedData.set(clientDataHash, authDataBytes.length);

  const sigBytes = base64UrlDecode(opts.signature);
  const publicKey = await importCosePublicKey(cred.publicKey);

  // Determine algorithm from key type
  const cose = parseCoseKey(cred.publicKey);
  let algorithm: AlgorithmIdentifier | EcdsaParams;
  if (cose.kty === 2 && cose.alg === -7) {
    algorithm = { name: 'ECDSA', hash: 'SHA-256' };
  } else if (cose.kty === 3 && cose.alg === -257) {
    algorithm = { name: 'RSASSA-PKCS1-v1_5' };
  } else {
    throw new Error('Unsupported key algorithm');
  }

  const valid = await crypto.subtle.verify(algorithm, publicKey, sigBytes, signedData);
  if (!valid) throw new Error('Signature verification failed');

  // 8. Check sign count (replay attack protection)
  if (cred.signCount > 0 && authData.signCount <= cred.signCount) {
    throw new Error('Sign count replay detected');
  }

  // 9. Update sign count
  await updatePasskeySignCount(opts.credentialId, authData.signCount);

  return { userId: cred.userId, credentialId: opts.credentialId };
}

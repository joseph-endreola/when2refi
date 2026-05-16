// when2refi.com — Cloudflare Worker API

export interface Env {
  DB: D1Database;
  CLERK_SECRET_KEY: string;
  CLERK_JWKS_URL: string;
}

// ---------------------------------------------------------------------------
// JWKS cache — module-level, survives across requests in the same isolate
// ---------------------------------------------------------------------------
interface SigningKeyRecord {
  kid: string;
  key: CryptoKey;
}

let jwksCache: { keys: SigningKeyRecord[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 3_600_000; // 1 hour

async function getSigningKeys(jwksUrl: string): Promise<SigningKeyRecord[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);

  const { keys } = await res.json<{ keys: JsonWebKey[] }>();

  const imported = await Promise.all(
    keys.map(async (jwk) => ({
      kid: jwk.kid as string,
      key: await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      ),
    }))
  );

  jwksCache = { keys: imported, fetchedAt: now };
  return imported;
}

// ---------------------------------------------------------------------------
// JWT verification — RS256, Web Crypto API only, no external dependencies
// ---------------------------------------------------------------------------
export interface JWTClaims {
  sub: string;
  exp: number;
  iat: number;
  iss: string;
  [key: string]: unknown;
}

function base64urlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function verifyClerkJWT(token: string, jwksUrl: string): Promise<JWTClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [headerB64, payloadB64, signatureB64] = parts;
  const decoder = new TextDecoder();

  const header = JSON.parse(decoder.decode(base64urlDecode(headerB64)));
  if (header.alg !== 'RS256') throw new Error(`Unsupported algorithm: ${header.alg}`);

  const payload: JWTClaims = JSON.parse(decoder.decode(base64urlDecode(payloadB64)));

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSeconds) throw new Error('JWT expired');

  const signingKeys = await getSigningKeys(jwksUrl);
  const record = signingKeys.find((k) => k.kid === header.kid);
  if (!record) throw new Error(`No signing key for kid: ${header.kid}`);

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecode(signatureB64);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    record.key,
    signature,
    signedData
  );

  if (!valid) throw new Error('JWT signature invalid');

  return payload;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// Returns claims if a valid Bearer token is present.
// Returns null if no Authorization header is present.
// Throws if a token is present but invalid — caller maps this to 401.
async function authenticate(request: Request, env: Env): Promise<JWTClaims | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyClerkJWT(token, env.CLERK_JWKS_URL);
}

// Returns a 401 Response if claims is null, otherwise returns null (proceed).
function requireAuth(claims: JWTClaims | null): Response | null {
  if (claims) return null;
  return json({ error: 'Unauthorized' }, 401);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // --- Health check (public, no auth) ---
    if (pathname === '/health' && method === 'GET') {
      return json({ status: 'ok' });
    }

    // --- DSC endpoints (public, no auth) ---
    // Phase 4: backwards calculation endpoints will be implemented here.
    if (pathname.startsWith('/api/v1/dsc')) {
      return json({ error: 'Not implemented' }, 501);
    }

    // --- All routes below require a valid Clerk JWT ---
    let claims: JWTClaims | null = null;
    try {
      claims = await authenticate(request, env);
    } catch {
      // Token present but invalid (expired, bad signature, wrong key)
      return json({ error: 'Unauthorized' }, 401);
    }

    // --- Properties (protected) ---
    if (pathname === '/api/v1/properties' && method === 'GET') {
      const authError = requireAuth(claims);
      if (authError) return authError;
      // Phase 5: query D1 for user's properties
      return json({ properties: [] });
    }

    if (pathname === '/api/v1/properties' && method === 'POST') {
      const authError = requireAuth(claims);
      if (authError) return authError;
      // Phase 5: insert property
      return json({ error: 'Not implemented' }, 501);
    }

    // --- Goals (protected) ---
    if (pathname.startsWith('/api/v1/goals') && method === 'GET') {
      const authError = requireAuth(claims);
      if (authError) return authError;
      // Phase 5: query D1 for property goals
      return json({ goals: [] });
    }

    return json({ error: 'Not found' }, 404);
  },
};

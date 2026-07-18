import { describe, it, expect } from 'vitest';
import {
  audienceMatches,
  hasScope,
  isAllowedRedirectUri,
  normalizeScope,
  verifyPkce,
} from '@/lib/mcp/oauth';

/**
 * The parts of the OAuth server that are pure functions — which is deliberately
 * where the security-critical decisions live, so they can be tested without a
 * database or a live client.
 */

describe('verifyPkce', () => {
  // From RFC 7636 Appendix B, so a bug in our base64url or digest handling
  // shows up as a mismatch against the spec's own vector rather than against
  // our other code.
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('accepts the verifier that produced the challenge', async () => {
    expect(await verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
  });

  it('rejects any other verifier', async () => {
    expect(await verifyPkce('a'.repeat(43), CHALLENGE)).toBe(false);
  });

  it('rejects a verifier that is a prefix or extension of the real one', async () => {
    expect(await verifyPkce(VERIFIER.slice(0, -1), CHALLENGE)).toBe(false);
    expect(await verifyPkce(`${VERIFIER}x`, CHALLENGE)).toBe(false);
  });

  it('rejects verifiers outside the RFC 7636 length bounds', async () => {
    // Short verifiers are the whole attack: 8 characters is guessable, and
    // accepting one silently downgrades PKCE to decoration.
    expect(await verifyPkce('short', CHALLENGE)).toBe(false);
    expect(await verifyPkce('a'.repeat(42), CHALLENGE)).toBe(false);
    expect(await verifyPkce('a'.repeat(129), CHALLENGE)).toBe(false);
  });

  it('rejects verifiers containing characters outside the unreserved set', async () => {
    expect(await verifyPkce(`${'a'.repeat(42)}+`, CHALLENGE)).toBe(false);
    expect(await verifyPkce(`${'a'.repeat(42)}/`, CHALLENGE)).toBe(false);
    expect(await verifyPkce(`${'a'.repeat(42)}=`, CHALLENGE)).toBe(false);
  });

  it('produces standard base64url, not base64', async () => {
    // A verifier whose digest contains bytes that encode to + and / in plain
    // base64. If padding or the alphabet were wrong, this passes locally and
    // fails against every real client.
    const verifier = 'x'.repeat(43);
    const challenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    ).toString('base64url');

    expect(challenge).not.toMatch(/[+/=]/);
    expect(await verifyPkce(verifier, challenge)).toBe(true);
  });
});

describe('isAllowedRedirectUri', () => {
  it('allows https', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
  });

  it('allows http only on loopback, for native clients', () => {
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:8080/cb')).toBe(true);
  });

  it('rejects plaintext http to a real host', () => {
    expect(isAllowedRedirectUri('http://evil.test/callback')).toBe(false);
    // Not a loopback address despite the name — resolves wherever DNS says.
    expect(isAllowedRedirectUri('http://localhost.evil.test/cb')).toBe(false);
  });

  it('rejects custom and dangerous schemes', () => {
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('data:text/html,<script>')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
    expect(isAllowedRedirectUri('myapp://callback')).toBe(false);
  });

  it('rejects a URI carrying a fragment', () => {
    // A fragment is never meaningful on a redirect target and is how a second
    // destination gets smuggled past a prefix check.
    expect(isAllowedRedirectUri('https://good.test/cb#https://evil.test')).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    expect(isAllowedRedirectUri('')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
    expect(isAllowedRedirectUri('///')).toBe(false);
  });
});

describe('normalizeScope', () => {
  it('defaults when nothing is requested', () => {
    expect(normalizeScope(null)).toBe('projects:read projects:write');
    expect(normalizeScope('')).toBe('projects:read projects:write');
  });

  it('keeps only supported scopes', () => {
    expect(normalizeScope('projects:read')).toBe('projects:read');
    expect(normalizeScope('projects:read projects:write')).toBe('projects:read projects:write');
  });

  it('drops unknown scopes rather than granting them', () => {
    // The important case: an invented scope must never widen the grant.
    expect(normalizeScope('projects:read admin:everything')).toBe('projects:read');
    expect(normalizeScope('projects:delete')).toBe('projects:read projects:write');
  });

  it('deduplicates', () => {
    expect(normalizeScope('projects:read projects:read')).toBe('projects:read');
  });

  it('tolerates irregular whitespace', () => {
    expect(normalizeScope('  projects:read   projects:write  ')).toBe('projects:read projects:write');
  });
});

describe('audienceMatches', () => {
  const HERE = 'https://pulse.example.com/api/mcp';

  it('accepts a token with no recorded audience', () => {
    // `resource` is optional; refusing these would break clients that never
    // opted into resource indicators.
    expect(audienceMatches(null, HERE)).toBe(true);
  });

  it('accepts an exact match', () => {
    expect(audienceMatches(HERE, HERE)).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(audienceMatches('https://pulse.example.com/api/mcp/', HERE)).toBe(true);
    expect(audienceMatches(HERE, 'https://pulse.example.com/api/mcp/')).toBe(true);
  });

  it('rejects a different host', () => {
    // The real case: a token minted through a Vercel preview URL must not act
    // on the production domain.
    expect(audienceMatches('https://pulse-git-preview.vercel.app/api/mcp', HERE)).toBe(false);
    expect(audienceMatches('https://evil.test/api/mcp', HERE)).toBe(false);
  });

  it('rejects a different path on the same host', () => {
    expect(audienceMatches('https://pulse.example.com/api/other', HERE)).toBe(false);
  });

  it('rejects a different scheme', () => {
    expect(audienceMatches('http://pulse.example.com/api/mcp', HERE)).toBe(false);
  });

  it('rejects an unparseable audience rather than passing it through', () => {
    expect(audienceMatches('not-a-url', HERE)).toBe(false);
  });
});

describe('hasScope', () => {
  it('matches whole scopes only', () => {
    expect(hasScope('projects:read projects:write', 'projects:write')).toBe(true);
    expect(hasScope('projects:read', 'projects:write')).toBe(false);
  });

  it('does not match on a prefix', () => {
    // "projects:read" must not satisfy a check for "projects:readwrite" or
    // similar, which a substring test would allow.
    expect(hasScope('projects:readonly', 'projects:read')).toBe(false);
  });
});

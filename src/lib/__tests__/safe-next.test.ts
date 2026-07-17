import { describe, it, expect } from 'vitest';
import { safeNext } from '@/lib/safe-next';

describe('safeNext', () => {
  it('defaults to /app when empty', () => {
    expect(safeNext(null)).toBe('/app');
    expect(safeNext(undefined)).toBe('/app');
    expect(safeNext('')).toBe('/app');
  });

  it('allows same-origin relative paths', () => {
    expect(safeNext('/app')).toBe('/app');
    expect(safeNext('/app/settings')).toBe('/app/settings');
    expect(safeNext('/app/projects/abc_123')).toBe('/app/projects/abc_123');
  });

  it('rejects open-redirect payloads', () => {
    // Protocol-relative and backslash/encoded variants that browsers normalize
    // into an authority all fall back to /app.
    expect(safeNext('//evil.com')).toBe('/app');
    expect(safeNext('/\\evil.com')).toBe('/app');
    expect(safeNext('/%2Fevil.com')).toBe('/app');
    expect(safeNext('https://evil.com')).toBe('/app');
    expect(safeNext('javascript:alert(1)')).toBe('/app');
  });
});

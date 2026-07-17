import { describe, it, expect } from 'vitest';
import { passwordStrength } from '@/lib/password-strength';

describe('passwordStrength', () => {
  it('scores anything under 8 chars as 0', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('1234567').score).toBe(0);
    expect(passwordStrength('short').label).toBe('At least 8 characters');
  });

  it('gives a bare 8-char password at least Weak', () => {
    const s = passwordStrength('aaaaaaaa');
    expect(s.score).toBe(1);
    expect(s.label).toBe('Weak');
  });

  it('rewards length and character variety', () => {
    expect(passwordStrength('aaaaaaaa').score).toBe(1); // bare 8-char floor
    expect(passwordStrength('abcABCdef').score).toBe(1); // 9 chars, mixed case only
    expect(passwordStrength('abcABCdef123').score).toBe(3); // 12+, mixed case, digits
  });

  it('caps at Strong (4)', () => {
    const s = passwordStrength('Xk9$muffin-Longer-Passphrase!');
    expect(s.score).toBe(4);
    expect(s.label).toBe('Strong');
  });
});

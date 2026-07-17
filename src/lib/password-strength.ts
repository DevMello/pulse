/**
 * A rough password-strength hint for the owner sign-up field.
 *
 * This is deliberately a heuristic, not a security control: Supabase enforces
 * the real minimum server-side, and a single-owner tool has no threat model
 * where a client-side meter matters. Its only job is to nudge the one person
 * who ever sees it away from an 8-character password they'll regret.
 *
 * Score 0 means "below the hard 8-char floor"; 1–4 map to Weak…Strong.
 */
export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

const LABELS = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' } as const;

export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length < 8) return { score: 0, label: 'At least 8 characters' };

  let points = 0;
  if (pw.length >= 12) points++;
  if (pw.length >= 16) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;

  // Meeting the 8-char floor is worth at least "Weak"; cap the rest at "Strong".
  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;
  return { score, label: LABELS[score] };
}

/**
 * Where to land after a successful sign-in.
 *
 * `next` is fully user-controlled (it rides in on a query param the middleware
 * copies from the requested path), so redirecting to it verbatim right after
 * establishing a session is a textbook open redirect.
 *
 * Allow-list rather than deny-list: `next` must start with a single "/" followed
 * by a character that can't begin an authority. A deny-list here is a trap —
 * blocking "//host" alone still lets "/\host" and "/%2Fhost" through, because
 * browsers normalize a backslash to a forward slash before parsing.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/app';
  if (!/^\/[A-Za-z0-9_\-]/.test(next)) return '/app';
  return next;
}

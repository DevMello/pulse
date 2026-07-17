'use client';

/**
 * Light/dark switch.
 *
 * Stateless on purpose: the theme lives on <html data-theme> (stamped pre-paint
 * by the root layout script), and which icon shows is decided by CSS via the
 * data-hide-* rules in globals.css. No useState, no mounted-gate, nothing to
 * mismatch on hydration — the server can render both icons blind.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('pulse-theme', next);
    } catch {
      // Storage can be blocked; the flip above still applies for this page.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-sunken hover:text-text"
    >
      {/* Shown on light: a moon, i.e. "switch to dark". */}
      <svg
        data-hide-dark
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
      {/* Shown on dark: a sun. */}
      <svg
        data-hide-light
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}

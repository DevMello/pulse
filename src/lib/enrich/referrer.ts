/**
 * Referrer normalization.
 *
 * Two jobs:
 *
 *   1. Reduce a referrer URL to a host. Full referrer URLs routinely carry
 *      query strings with session tokens and personal data, so the path and
 *      query are dropped here and never reach the database.
 *   2. Group hosts into sources a human would recognize. Raw hosts scatter one
 *      source across dozens of rows — google.com, www.google.co.uk,
 *      news.google.com — which makes "where do my visitors come from?"
 *      unanswerable. All of those are "Google".
 */

/** Exact-host matches, checked first. */
const EXACT: Record<string, string> = {
  't.co': 'Twitter',
  'lnkd.in': 'LinkedIn',
  'news.ycombinator.com': 'Hacker News',
  'ycombinator.com': 'Hacker News',
  'old.reddit.com': 'Reddit',
  'out.reddit.com': 'Reddit',
  'l.facebook.com': 'Facebook',
  'lm.facebook.com': 'Facebook',
  'l.instagram.com': 'Instagram',
  'away.vk.com': 'VK',
  'com.google.android.gm': 'Gmail',
  'mail.google.com': 'Gmail',
  'default': 'Direct',
};

/**
 * Domain-suffix matches. Keyed on the registrable-ish domain so every ccTLD and
 * subdomain of a source collapses together.
 */
const SUFFIX: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/, 'Google'],
  [/(^|\.)bing\.[a-z.]+$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'Yahoo'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex'],
  [/(^|\.)baidu\.com$/, 'Baidu'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/(^|\.)brave\.com$/, 'Brave Search'],
  [/(^|\.)search\.marginalia\.nu$/, 'Marginalia'],
  [/(^|\.)kagi\.com$/, 'Kagi'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'ChatGPT'],
  [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, 'Claude'],
  [/(^|\.)gemini\.google\.com$/, 'Gemini'],

  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'Twitter'],
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest'],
  [/(^|\.)mastodon\.[a-z.]+$|(^|\.)fosstodon\.org$|(^|\.)hachyderm\.io$/, 'Mastodon'],
  [/(^|\.)bsky\.app$|(^|\.)bsky\.social$/, 'Bluesky'],
  [/(^|\.)threads\.net$/, 'Threads'],
  [/(^|\.)discord\.com$|(^|\.)discordapp\.com$/, 'Discord'],
  [/(^|\.)slack\.com$/, 'Slack'],
  [/(^|\.)t\.me$|(^|\.)telegram\.org$/, 'Telegram'],
  [/(^|\.)whatsapp\.com$/, 'WhatsApp'],

  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)gitlab\.com$/, 'GitLab'],
  [/(^|\.)stackoverflow\.com$|(^|\.)stackexchange\.com$/, 'Stack Overflow'],
  [/(^|\.)producthunt\.com$/, 'Product Hunt'],
  [/(^|\.)dev\.to$/, 'DEV'],
  [/(^|\.)medium\.com$/, 'Medium'],
  [/(^|\.)substack\.com$/, 'Substack'],
  [/(^|\.)hashnode\.(com|dev)$/, 'Hashnode'],
  [/(^|\.)lobste\.rs$/, 'Lobsters'],
  [/(^|\.)indiehackers\.com$/, 'Indie Hackers'],
];

export interface NormalizedReferrer {
  host: string | null;
  group: string;
}

/**
 * @param referrer   the raw document.referrer, may be empty
 * @param selfHost   the tracked site's own hostname; self-referrals are
 *                   internal navigation, not a traffic source
 */
export function normalizeReferrer(
  referrer: string | null | undefined,
  selfHost?: string | null
): NormalizedReferrer {
  if (!referrer) return { host: null, group: 'Direct' };

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // A referrer we can't parse tells us nothing; treat it as no referrer
    // rather than inventing a source.
    return { host: null, group: 'Direct' };
  }

  if (!host) return { host: null, group: 'Direct' };

  // Self-referrals: a visitor clicking around the site is not a new source.
  if (selfHost) {
    const self = selfHost.toLowerCase().replace(/^www\./, '');
    if (host === self || host.endsWith('.' + self)) return { host: null, group: 'Direct' };
  }

  const exact = EXACT[host];
  if (exact) return { host, group: exact };

  for (const [re, name] of SUFFIX) {
    if (re.test(host)) return { host, group: name };
  }

  // Unrecognized sources keep their host, so the long tail stays visible
  // instead of collapsing into a useless "Other" bucket.
  return { host, group: host };
}

/**
 * UTM parameters. Campaign attribution is explicitly opted into by whoever
 * built the link, so these are the one part of the query string worth keeping —
 * everything else in it is dropped.
 */
export interface UTM {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
}

const UTM_MAX = 200;

export function extractUTM(params: URLSearchParams): UTM {
  const get = (...names: string[]): string | null => {
    for (const n of names) {
      const v = params.get(n);
      if (v) return v.slice(0, UTM_MAX);
    }
    return null;
  };

  return {
    // The short aliases are what ad platforms actually emit on autotagged links.
    utm_source: get('utm_source', 'ref', 'source'),
    utm_medium: get('utm_medium', 'utm_med'),
    utm_campaign: get('utm_campaign', 'utm_camp', 'campaign'),
    utm_term: get('utm_term'),
    utm_content: get('utm_content'),
  };
}

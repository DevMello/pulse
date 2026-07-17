/**
 * Bot filtering.
 *
 * This is what makes the public page defensible. A stats page that counts
 * crawlers is a vanity number, and the moment someone notices, every other
 * figure on the page stops being believed too (Section 10.4).
 *
 * Two aggressiveness levels the owner picks per project:
 *
 *   standard  self-identifying bots — crawlers, previewers, monitors, libraries.
 *             Almost no false positives.
 *   strict    adds heuristics that catch bots which pretend to be browsers, at
 *             the cost of occasionally dropping a real, unusual visitor.
 */

export type BotFilterLevel = 'off' | 'standard' | 'strict';

/**
 * Substrings that appear in honest bot UAs. Lowercased comparison.
 *
 * `bot`, `crawl`, and `spider` catch the overwhelming majority on their own;
 * the rest are the well-known agents that don't use those words.
 */
const BOT_TOKENS = [
  'bot', 'crawl', 'spider', 'slurp', 'scrap',
  // Link previewers. These fire on every paste into a chat app and would
  // otherwise make a link shared in a big Slack look like a traffic spike.
  'facebookexternalhit', 'whatsapp', 'telegrambot', 'discordbot', 'slackbot',
  'twitterbot', 'linkedinbot', 'redditbot', 'skypeuripreview', 'embedly',
  'quora link preview', 'nuzzel', 'outbrain', 'vkshare', 'w3c_validator',
  'iframely', 'opengraph', 'snapchat', 'flipboard',
  // Monitors and checkers.
  'pingdom', 'uptimerobot', 'statuscake', 'site24x7', 'newrelic', 'datadog',
  'gtmetrix', 'lighthouse', 'pagespeed', 'chrome-lighthouse', 'headlesschrome',
  'phantomjs', 'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot',
  'bingpreview', 'yandexbot', 'baiduspider', 'duckduckbot', 'applebot',
  'ia_archiver', 'archive.org_bot', 'wayback',
  // HTTP libraries and CLIs — never a real visitor.
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'httpie', 'go-http-client',
  'java/', 'okhttp', 'axios/', 'node-fetch', 'got/', 'guzzle', 'libwww-perl',
  'apache-httpclient', 'postmanruntime', 'insomnia', 'restsharp', 'httpclient',
  // AI crawlers.
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-web',
  'anthropic-ai', 'perplexitybot', 'ccbot', 'google-extended', 'bytespider',
  'amazonbot', 'youbot', 'diffbot', 'cohere-ai', 'meta-externalagent',
];

export interface BotCheckInput {
  userAgent: string | null | undefined;
  level: BotFilterLevel;
  /** Screen width reported by the client; absent/zero from most headless setups. */
  screenWidth?: number | null;
  /** Whether the request carried a referrer. */
  hasReferrer?: boolean;
}

export interface BotVerdict {
  isBot: boolean;
  /** Why it was flagged — surfaced in the dashboard so filtering is auditable. */
  reason?: string;
}

export function detectBot(input: BotCheckInput): BotVerdict {
  const { userAgent, level } = input;

  if (level === 'off') return { isBot: false };

  // No UA at all is not a browser. Every real browser sends one.
  if (!userAgent || !userAgent.trim()) {
    return { isBot: true, reason: 'missing user-agent' };
  }

  const ua = userAgent.toLowerCase();

  for (const token of BOT_TOKENS) {
    if (ua.includes(token)) return { isBot: true, reason: `ua contains "${token}"` };
  }

  if (level !== 'strict') return { isBot: false };

  // ---- strict-only heuristics ------------------------------------------------

  // Real browsers always identify as Mozilla/5.0. Nothing else legitimate does.
  if (!ua.startsWith('mozilla/')) {
    return { isBot: true, reason: 'non-browser user-agent' };
  }

  // A viewport of zero means nothing was rendered.
  if (input.screenWidth === 0) {
    return { isBot: true, reason: 'zero viewport' };
  }

  // Headless Chrome's giveaway: real Chrome never omits a Chrome/ version while
  // still claiming Safari + AppleWebKit.
  if (ua.includes('applewebkit') && ua.includes('safari') &&
      !ua.includes('chrome') && !ua.includes('version/') && !ua.includes('firefox')) {
    return { isBot: true, reason: 'webkit without browser version' };
  }

  return { isBot: false };
}

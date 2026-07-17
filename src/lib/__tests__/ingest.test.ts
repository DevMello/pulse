import { describe, it, expect, beforeEach } from 'vitest';
import { prepareEvent, domainAllowed, isExcluded, extractProps } from '../ingest';
import { parseUserAgent, screenBucket } from '../enrich/ua';
import { normalizeReferrer, extractUTM } from '../enrich/referrer';
import { detectBot } from '../enrich/bots';
import { computeVisitorHash, clientIp } from '../enrich/visitor';
import { rateLimit, _resetRateLimits } from '../ratelimit';
import { toMinorUnits, convertMinor, currencyDecimals } from '../money';

const project = {
  id: 'p1',
  domains: ['example.com'],
  bot_filter: 'standard' as const,
  excluded_paths: [],
  respect_dnt: false,
};

const ctx = {
  project,
  salt: 'salt-of-the-day',
  ip: '203.0.113.5',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  country: 'US',
  region: 'CA',
};

describe('domainAllowed', () => {
  it('matches the domain and its subdomains', () => {
    expect(domainAllowed('example.com', ['example.com'])).toBe(true);
    expect(domainAllowed('blog.example.com', ['example.com'])).toBe(true);
    expect(domainAllowed('www.example.com', ['example.com'])).toBe(true);
  });

  it('rejects lookalikes that merely end with the same letters', () => {
    // The bug this guards: endsWith('example.com') alone would allow this.
    expect(domainAllowed('notexample.com', ['example.com'])).toBe(false);
    expect(domainAllowed('example.com.evil.net', ['example.com'])).toBe(false);
  });
});

describe('isExcluded', () => {
  it('does exact and prefix matching', () => {
    expect(isExcluded('/admin', ['/admin'])).toBe(true);
    expect(isExcluded('/admin/users', ['/admin'])).toBe(false);
    expect(isExcluded('/admin/users', ['/admin*'])).toBe(true);
    expect(isExcluded('/public', ['/admin*'])).toBe(false);
  });
});

describe('parseUserAgent', () => {
  it('picks Edge over Chrome, since Edge claims to be Chrome', () => {
    const ua = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'
    );
    expect(ua.browser).toBe('Edge');
    expect(ua.os).toBe('Windows');
    expect(ua.device).toBe('desktop');
  });

  it('picks Chrome over Safari, since Chrome claims to be Safari', () => {
    expect(parseUserAgent(ctx.userAgent).browser).toBe('Chrome');
  });

  it('recognizes real Safari', () => {
    const ua = parseUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    );
    expect(ua.browser).toBe('Safari');
    expect(ua.os).toBe('macOS');
  });

  it('classifies Android phone vs tablet by the Mobile token', () => {
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36').device).toBe('mobile');
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36').device).toBe('tablet');
  });

  it('reports Android as Android, not Linux', () => {
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36').os).toBe('Android');
  });

  it('survives a missing UA', () => {
    expect(parseUserAgent(null)).toEqual({ device: 'desktop', browser: 'Unknown', os: 'Unknown' });
  });
});

describe('screenBucket', () => {
  it('buckets rather than storing exact widths', () => {
    expect(screenBucket(375)).toBe('xs');
    expect(screenBucket(768)).toBe('md');
    expect(screenBucket(1920)).toBe('xl');
    expect(screenBucket(0)).toBeNull();
    expect(screenBucket(null)).toBeNull();
  });
});

describe('normalizeReferrer', () => {
  it('groups every Google property together', () => {
    expect(normalizeReferrer('https://www.google.com/search?q=x').group).toBe('Google');
    expect(normalizeReferrer('https://google.co.uk/').group).toBe('Google');
    expect(normalizeReferrer('https://news.google.com/').group).toBe('Google');
  });

  it('maps t.co to Twitter', () => {
    expect(normalizeReferrer('https://t.co/abc').group).toBe('Twitter');
  });

  it('treats self-referrals as Direct, not a source', () => {
    expect(normalizeReferrer('https://example.com/page', 'example.com').group).toBe('Direct');
    expect(normalizeReferrer('https://blog.example.com/p', 'example.com').group).toBe('Direct');
  });

  it('keeps unknown hosts instead of lumping them into Other', () => {
    expect(normalizeReferrer('https://someblog.dev/post').group).toBe('someblog.dev');
  });

  it('drops the path and query, keeping only the host', () => {
    // The referrer URL can carry tokens; only the host may be stored.
    const r = normalizeReferrer('https://app.example.org/reset?token=SECRET');
    expect(r.host).toBe('app.example.org');
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });

  it('treats an unparseable referrer as Direct', () => {
    expect(normalizeReferrer('not a url').group).toBe('Direct');
    expect(normalizeReferrer('').group).toBe('Direct');
  });
});

describe('extractUTM', () => {
  it('pulls campaign params', () => {
    const utm = extractUTM(new URLSearchParams('utm_source=hn&utm_medium=social&utm_campaign=launch'));
    expect(utm.utm_source).toBe('hn');
    expect(utm.utm_medium).toBe('social');
    expect(utm.utm_campaign).toBe('launch');
  });

  it('accepts ref= as a source alias', () => {
    expect(extractUTM(new URLSearchParams('ref=producthunt')).utm_source).toBe('producthunt');
  });
});

describe('detectBot', () => {
  it('catches self-identifying crawlers', () => {
    expect(detectBot({ userAgent: 'Googlebot/2.1', level: 'standard' }).isBot).toBe(true);
    expect(detectBot({ userAgent: 'curl/8.4.0', level: 'standard' }).isBot).toBe(true);
    expect(detectBot({ userAgent: 'GPTBot/1.0', level: 'standard' }).isBot).toBe(true);
  });

  it('catches link previewers that would fake a spike on a shared link', () => {
    expect(detectBot({ userAgent: 'Slackbot-LinkExpanding 1.0', level: 'standard' }).isBot).toBe(true);
    expect(detectBot({ userAgent: 'facebookexternalhit/1.1', level: 'standard' }).isBot).toBe(true);
  });

  it('lets real browsers through', () => {
    expect(detectBot({ userAgent: ctx.userAgent, level: 'standard' }).isBot).toBe(false);
  });

  it('treats a missing UA as a bot', () => {
    expect(detectBot({ userAgent: null, level: 'standard' }).isBot).toBe(true);
  });

  it('records nothing when filtering is off, except that it still passes', () => {
    expect(detectBot({ userAgent: 'Googlebot/2.1', level: 'off' }).isBot).toBe(false);
  });

  it('strict adds heuristics that standard does not apply', () => {
    const ua = 'SomeTool/1.0';
    expect(detectBot({ userAgent: ua, level: 'standard' }).isBot).toBe(false);
    expect(detectBot({ userAgent: ua, level: 'strict' }).isBot).toBe(true);
  });
});

describe('computeVisitorHash', () => {
  const base = { salt: 's', projectId: 'p1', ip: '1.2.3.4', userAgent: 'UA' };

  it('is stable for the same visitor on the same day', async () => {
    expect(await computeVisitorHash(base)).toBe(await computeVisitorHash(base));
  });

  it('changes when the salt rotates, which is what stops cross-day tracking', async () => {
    expect(await computeVisitorHash(base)).not.toBe(
      await computeVisitorHash({ ...base, salt: 'tomorrow' })
    );
  });

  it('differs across projects, which is what stops cross-site tracking', async () => {
    expect(await computeVisitorHash(base)).not.toBe(
      await computeVisitorHash({ ...base, projectId: 'p2' })
    );
  });

  it('differs for different visitors', async () => {
    expect(await computeVisitorHash(base)).not.toBe(
      await computeVisitorHash({ ...base, ip: '5.6.7.8' })
    );
  });

  it('cannot be collided by shifting a value across a field boundary', async () => {
    // Without a separator, ip="1.2" + ua="3.4" and ip="1.23" + ua=".4" would
    // hash identically.
    const a = await computeVisitorHash({ ...base, ip: '1.2', userAgent: '3.4' });
    const b = await computeVisitorHash({ ...base, ip: '1.23', userAgent: '.4' });
    expect(a).not.toBe(b);
  });

  it('does not contain the raw inputs', async () => {
    const h = await computeVisitorHash(base);
    expect(h).not.toContain('1.2.3.4');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('clientIp', () => {
  it('prefers x-real-ip over client-spoofable x-forwarded-for', () => {
    const h = new Headers({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' });
    expect(clientIp(h)).toBe('9.9.9.9');
  });

  it('falls back to the leftmost forwarded-for entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
  });

  it('returns null when there is nothing to read', () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe('extractProps', () => {
  it('lifts revenue out of props', () => {
    const { props, revenue } = extractProps({ revenue: { amount: 29, currency: 'USD' }, plan: 'pro' });
    expect(revenue).toEqual({ amount: 29, currency: 'USD', amountMinor: 2900 });
    expect(props).toEqual({ plan: 'pro' });
  });

  it('defaults revenue currency to USD', () => {
    expect(extractProps({ revenue: { amount: 5 } }).revenue?.currency).toBe('USD');
  });

  it('rejects a nonsense revenue claim rather than writing a wrong number', () => {
    expect(extractProps({ revenue: { amount: NaN } }).revenue).toBeNull();
    expect(extractProps({ revenue: { amount: -5 } }).revenue).toBeNull();
    expect(extractProps({ revenue: 'free money' }).revenue).toBeNull();
  });

  it('drops nested objects so props cannot become unbounded', () => {
    const { props } = extractProps({ ok: 'yes', nested: { a: 1 }, arr: [1, 2] });
    expect(props).toEqual({ ok: 'yes' });
  });

  it('extracts revenue even when it follows more props than the cap allows', () => {
    // Regression: revenue used to be lifted during iteration, so the props-count
    // cap could break out of the loop before reaching a trailing `revenue` key
    // and silently discard a real sale.
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) many[`p${i}`] = i;
    many.revenue = { amount: 29, currency: 'USD' };

    const { revenue, props } = extractProps(many);
    expect(revenue).toEqual({ amount: 29, currency: 'USD', amountMinor: 2900 });
    expect(Object.keys(props ?? {}).length).toBeLessThanOrEqual(24);
    expect(props).not.toHaveProperty('revenue');
  });

  it('returns null for empty or non-object input', () => {
    expect(extractProps(null).props).toBeNull();
    expect(extractProps({}).props).toBeNull();
    expect(extractProps([1, 2]).props).toBeNull();
  });
});

describe('money', () => {
  it('knows which currencies have no minor unit', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(3);
  });

  it('converts major to minor units per currency precision', () => {
    expect(toMinorUnits(29.99, 'USD')).toBe(2999);
    expect(toMinorUnits(1000, 'JPY')).toBe(1000);
    expect(toMinorUnits(1.5, 'KWD')).toBe(1500);
  });

  it('avoids float drift', () => {
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
  });

  it('converts across currencies through major units', () => {
    expect(convertMinor({ amountMinor: 1000, from: 'EUR', to: 'USD', rates: { EUR: 1.1 } })).toBe(1100);
  });

  it('passes an unknown currency through rather than dropping the money', () => {
    expect(convertMinor({ amountMinor: 500, from: 'XYZ', to: 'USD', rates: {} })).toBe(500);
  });
});

describe('rateLimit', () => {
  beforeEach(() => _resetRateLimits());

  it('allows a burst then blocks', () => {
    const opts = { ratePerSecond: 1, burst: 3 };
    expect(rateLimit('k', opts).ok).toBe(true);
    expect(rateLimit('k', opts).ok).toBe(true);
    expect(rateLimit('k', opts).ok).toBe(true);
    expect(rateLimit('k', opts).ok).toBe(false);
  });

  it('keeps buckets separate per key', () => {
    const opts = { ratePerSecond: 1, burst: 1 };
    expect(rateLimit('a', opts).ok).toBe(true);
    expect(rateLimit('a', opts).ok).toBe(false);
    expect(rateLimit('b', opts).ok).toBe(true);
  });
});

describe('prepareEvent', () => {
  it('enriches a pageview end to end', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'pageview', u: 'https://example.com/pricing?utm_source=hn', r: 'https://news.ycombinator.com/', w: 1440 },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.path).toBe('/pricing');
    expect(result.event.is_pageview).toBe(true);
    expect(result.event.referrer_group).toBe('Hacker News');
    expect(result.event.utm_source).toBe('hn');
    expect(result.event.browser).toBe('Chrome');
    expect(result.event.country).toBe('US');
    expect(result.event.screen_bucket).toBe('xl');
    expect(result.event.visitor_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never stores the query string beyond UTM keys', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'pageview', u: 'https://example.com/reset?token=SECRET&email=a@b.com', w: 1440 },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.event);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('a@b.com');
    expect(result.event.path).toBe('/reset');
  });

  it('keeps hash routes as distinct paths', async () => {
    const result = await prepareEvent({ k: 'key', n: 'pageview', u: 'https://example.com/app#/settings', w: 1440 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.path).toBe('/app#/settings');
  });

  it('ignores a plain anchor, which is not a route', async () => {
    const result = await prepareEvent({ k: 'key', n: 'pageview', u: 'https://example.com/docs#install', w: 1440 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.path).toBe('/docs');
  });

  it('rejects a domain that is not allow-listed', async () => {
    const result = await prepareEvent({ k: 'key', n: 'pageview', u: 'https://evil.com/', w: 1440 }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it('accepts any domain when the allow-list is empty', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'pageview', u: 'https://anywhere.dev/', w: 1440 },
      { ...ctx, project: { ...project, domains: [] } }
    );
    expect(result.ok).toBe(true);
  });

  it('drops excluded paths', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'pageview', u: 'https://example.com/admin/users', w: 1440 },
      { ...ctx, project: { ...project, excluded_paths: ['/admin*'] } }
    );
    expect(result.ok).toBe(false);
  });

  it('drops bots', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'pageview', u: 'https://example.com/', w: 1440 },
      { ...ctx, userAgent: 'Googlebot/2.1' }
    );
    expect(result.ok).toBe(false);
  });

  it('carries an SDK revenue claim through', async () => {
    const result = await prepareEvent(
      { k: 'key', n: 'purchase', u: 'https://example.com/thanks', w: 1440, p: { revenue: { amount: 29, currency: 'EUR' }, plan: 'pro' } },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.is_pageview).toBe(false);
    expect(result.revenue).toEqual({ amount: 29, currency: 'EUR', amountMinor: 2900 });
    expect(result.event.props).toEqual({ plan: 'pro' });
  });

  it('rejects a payload with no name or url', async () => {
    expect((await prepareEvent({ k: 'key', u: 'https://example.com/' }, ctx)).ok).toBe(false);
    expect((await prepareEvent({ k: 'key', n: 'pageview' }, ctx)).ok).toBe(false);
    expect((await prepareEvent({ k: 'key', n: 'pageview', u: 'nonsense' }, ctx)).ok).toBe(false);
  });
});

/**
 * User-Agent parsing.
 *
 * Deliberately hand-rolled and small rather than pulling in ua-parser-js: this
 * runs on the edge for every single event, we only need three coarse fields,
 * and the raw UA string is discarded immediately after this function returns.
 * It is never stored — Section 4.3.
 *
 * Order matters throughout. Nearly every browser lies about being every other
 * browser, so the checks run most-specific first: Edge claims to be Chrome,
 * Chrome claims to be Safari, and everything claims to be Mozilla.
 */

export type DeviceClass = 'desktop' | 'mobile' | 'tablet';

export interface ParsedUA {
  device: DeviceClass;
  browser: string;
  os: string;
}

const BROWSERS: Array<[RegExp, string]> = [
  // Must precede Chrome: both send "Chrome/" in their UA.
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bYaBrowser\//, 'Yandex'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bBrave\//, 'Brave'],
  [/\bDuckDuckGo\//, 'DuckDuckGo'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  // Last: every WebKit browser carries "Safari/", so this only matches once the
  // more specific engines above have been ruled out.
  [/\bSafari\//, 'Safari'],
];

const OSES: Array<[RegExp, string]> = [
  // Before Android: Android UAs contain "Linux".
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bUbuntu\b/, 'Ubuntu'],
  [/\bLinux\b/, 'Linux'],
];

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  if (!ua) return { device: 'desktop', browser: 'Unknown', os: 'Unknown' };

  let browser = 'Unknown';
  for (const [re, name] of BROWSERS) {
    if (re.test(ua)) {
      browser = name;
      break;
    }
  }

  let os = 'Unknown';
  for (const [re, name] of OSES) {
    if (re.test(ua)) {
      os = name;
      break;
    }
  }

  return { device: deviceClass(ua), browser, os };
}

function deviceClass(ua: string): DeviceClass {
  // iPad reports "Macintosh" in desktop-mode Safari, so it can't be
  // distinguished from a Mac by UA alone. It lands in desktop. That is a known
  // and accepted inaccuracy: the alternative is touch-point fingerprinting,
  // which is exactly what Pulse refuses to do.
  if (/\biPad\b/.test(ua) || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua))) return 'tablet';
  if (/\bTablet\b|\bPlayBook\b|\bSilk\b/.test(ua)) return 'tablet';
  if (/\bMobi\b|\bMobile\b|\biPhone\b|\biPod\b|\bIEMobile\b|\bOpera Mini\b/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Screen width -> bucket. Never the exact pixel value (Section 4.3): exact
 * viewport dimensions are a meaningful fingerprinting signal, and "is this
 * layout working on phones" only needs the bucket.
 */
export function screenBucket(width: number | null | undefined): string | null {
  if (!width || width <= 0) return null;
  if (width < 576) return 'xs';
  if (width < 768) return 'sm';
  if (width < 992) return 'md';
  if (width < 1440) return 'lg';
  return 'xl';
}

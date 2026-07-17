/**
 * Pulse tracker.
 *
 * Budget: ~1 KB gzipped. scripts/build-tracker.mjs fails the build if it grows
 * past the ceiling, so weigh every addition — this file runs on other people's
 * sites and its cost is paid by their visitors, not by us.
 *
 * Three rules shape everything here:
 *
 *   1. Never break the host page. The whole body is wrapped in try/catch and
 *      every listener swallows its own errors. A broken analytics call must be
 *      invisible to the site it runs on.
 *   2. Never store anything. No cookies, no localStorage writes, no IDs. The
 *      only localStorage access is a *read* of an opt-out flag.
 *   3. Send as little as possible. Enrichment (UA, geo, referrer grouping)
 *      happens server-side from data the request already carries, so the
 *      payload stays tiny and the client stays dumb.
 *
 * Configuration is read from the script tag's data-* attributes:
 *
 *   data-key          required. The project's public ingest key.
 *   data-host         override the collector origin (default: this script's).
 *   data-manual       don't auto-track pageviews; call pulse() yourself.
 *   data-respect-dnt  drop events from DNT / GPC browsers.
 *   data-local        also track localhost / file:// (off by default).
 *   data-exclude      comma-separated paths to skip; trailing * is a prefix.
 */
(function (w, d) {
  try {
    var script = d.currentScript;
    if (!script) return;

    var key = script.getAttribute('data-key');
    if (!key) return;

    var api = (script.getAttribute('data-host') || new URL(script.src).origin) + '/api/event';
    var loc = w.location;
    var nav = w.navigator;
    var last;

    function flag(name) {
      return script.getAttribute('data-' + name) != null;
    }

    /** Reasons to stay silent. Checked on every send, not just at load. */
    function ignored() {
      // The owner's own visits and staging environments. A read, never a write:
      // setting this is the documented opt-out, and Pulse never sets it itself.
      try {
        if (w.localStorage.getItem('pulse_ignore')) return 1;
      } catch (e) {
        // localStorage throws in sandboxed iframes / blocked-cookie modes.
      }

      if (flag('respect-dnt') &&
          (nav.doNotTrack == '1' || w.doNotTrack == '1' || nav.msDoNotTrack == '1' ||
           nav.globalPrivacyControl)) return 1;

      if (!flag('local') &&
          (loc.protocol === 'file:' ||
           /^(localhost|127\.|\[?::1\]?|.*\.local)$/.test(loc.hostname))) return 1;

      // Cheap client-side bot signals. The server does the real filtering; this
      // just avoids the request.
      if (nav.webdriver || w._phantom || w.__nightmare || w.callPhantom) return 1;

      var ex = script.getAttribute('data-exclude');
      if (ex) {
        var path = loc.pathname;
        var list = ex.split(',');
        for (var i = 0; i < list.length; i++) {
          var p = list[i].trim();
          if (!p) continue;
          if (p === path) return 1;
          if (p.charAt(p.length - 1) === '*' && path.indexOf(p.slice(0, -1)) === 0) return 1;
        }
      }
      return 0;
    }

    function send(name, props) {
      try {
        if (ignored()) return;

        var body = {
          k: key,
          n: name,
          // The full href goes over the wire, but the collector keeps only the
          // pathname and the UTM keys — the rest of the query string is dropped
          // before the row is written and is never stored.
          u: loc.href,
          r: d.referrer || null,
          // Raw width; the server buckets it. Sending the bucket instead would
          // move a decision into 40 bytes of client code for no privacy gain,
          // since width alone is not identifying.
          w: w.innerWidth || 0
        };
        if (props) body.p = props;

        var json = JSON.stringify(body);

        // sendBeacon posts text/plain, which is a CORS "simple request" — no
        // preflight, so a pageview costs exactly one request. It also survives
        // the page being unloaded, which fetch() alone does not.
        if (!(nav.sendBeacon && nav.sendBeacon(api, json))) {
          w.fetch(api, {
            method: 'POST',
            body: json,
            keepalive: true,
            headers: { 'Content-Type': 'text/plain' }
          })['catch'](function () {});
        }
      } catch (e) {
        // Swallowed on purpose. See rule 1.
      }
    }

    function pageview() {
      // Guards against the double-fire that SPA routers cause when they both
      // pushState and emit their own navigation event for one route change.
      if (loc.href === last) return;
      last = loc.href;
      send('pageview');
    }

    /**
     * The public API: pulse(name, props).
     *
     * Revenue rides along inside props, e.g.
     *   pulse('purchase', { revenue: { amount: 29, currency: 'USD' }, plan: 'pro' })
     * The collector lifts `revenue` out and normalizes it. Keeping that split
     * server-side is what lets this function stay one branch long.
     */
    function pulse(name, props) {
      if (!name || name === 'pageview') pageview();
      else send(name, props);
    }

    // Drain calls made before this script finished loading, via the documented
    // stub: window.pulse=window.pulse||function(){(pulse.q=pulse.q||[]).push(arguments)}
    var queued = w.pulse && w.pulse.q;
    w.pulse = pulse;
    if (queued) {
      for (var i = 0; i < queued.length; i++) pulse.apply(null, queued[i]);
    }

    if (!flag('manual')) {
      var push = w.history && w.history.pushState;
      if (push) {
        w.history.pushState = function () {
          push.apply(this, arguments);
          pageview();
        };
        w.addEventListener('popstate', pageview);
      }
      // Hash routers change the URL without touching History. pageview()'s own
      // dedupe makes the overlap with pushState harmless.
      w.addEventListener('hashchange', pageview);

      if (d.visibilityState === 'prerender') {
        // Chrome prerenders pages the user may never look at. Counting those
        // would be exactly the vanity inflation the public page must avoid.
        d.addEventListener('visibilitychange', function () {
          if (d.visibilityState === 'visible') pageview();
        });
      } else {
        pageview();
      }
    }
  } catch (e) {
    // Swallowed on purpose. See rule 1.
  }
})(window, document);

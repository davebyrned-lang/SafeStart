/* SafeStart service worker.
 *
 * Generated into /sw.js by scripts/build.js, which substitutes a3b586e40d1d
 * with a hash of the template plus both JSON files. Edit this file, not the
 * built one.
 *
 * ---------------------------------------------------------------------------
 * The one rule that matters
 * ---------------------------------------------------------------------------
 *
 * The crisis pages under /help/ are never served from cache while a network
 * exists. Everything else on this site can be a few days out of date and a
 * parent still ends up better off. A stale crisis page sends a frightened
 * person to a reporting route that has moved, or to an organisation that has
 * been renamed, and that is the one failure this site cannot have.
 *
 * So /help/ is network-first with no timeout shortcut: if the network answers,
 * the network wins, every time. The cached copy exists only for the case where
 * there is no network at all, because a slightly old crisis page still beats a
 * browser error page when someone is frightened at 2am.
 *
 * ---------------------------------------------------------------------------
 * Everything else
 * ---------------------------------------------------------------------------
 *
 * Fonts and icons are cache-first. They are content-hashed at the CDN and
 * already served immutable, so re-fetching them is waste.
 *
 * Pages and guides.json are network-first with a cache fallback. That keeps
 * corrections arriving the moment they ship, which is the whole promise of the
 * changelog, and still gives a parent the full set of guides on a train.
 *
 * /api/ is never touched. Those responses are per-request, one of them streams,
 * and one of them sends mail. A cached API response would be wrong in every
 * case, so the worker declines to have an opinion about them.
 */

var VERSION = "a3b586e40d1d";
var CACHE = "safestart-" + VERSION;

/* Precached on install.
 *
 * Deliberately not every page. Each built page inlines the whole front end and
 * runs about 180KB, so precaching all 39 would be roughly 7MB on a parent's
 * phone before they have read anything.
 *
 * It does not need to be. guides.json holds every guide's full content, so the
 * app can render any of the 29 offline from the home page alone. The crisis
 * pages are the exception: they deliberately run no JavaScript, so each one has
 * to be cached as a whole page, and they are the pages most worth having when
 * everything else has gone wrong. */
var PRECACHE = [
  "/",
  "/guides.json",
  "/safeguarding.json",
  "/help/",
  "/help/uk/",
  "/help/us/",
  "/help/ca/",
  "/help/ie/",
  "/assets/fonts/atkinson-latin.woff2",
  "/assets/icon-192-v2.png",
  "/assets/icon-512-v2.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll rejects the whole batch if any single request fails, which would
      // leave a parent with no offline support because one icon 404ed. Each one
      // is fetched on its own and a failure is allowed to pass.
      .then(function (c) {
        return Promise.all(PRECACHE.map(function (u) {
          return c.add(new Request(u, { cache: "reload" })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k !== CACHE && k.indexOf("safestart-") === 0 ? caches.delete(k) : null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function isCrisis(url) {
  return /^\/help(\/|$)/.test(url.pathname);
}

function isImmutableAsset(url) {
  return /^\/assets\//.test(url.pathname) && !/\.json$/.test(url.pathname);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Other origins are not ours to cache, and this site makes no third-party
  // requests anyway, so anything here is unexpected and gets left alone.
  if (url.origin !== self.location.origin) return;

  // Never the API. One of these streams and one of them sends mail.
  if (/^\/api\//.test(url.pathname)) return;

  // Cache-first, for the things that genuinely do not change.
  if (isImmutableAsset(url)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  /* Network-first for everything else.
   *
   * On a crisis page a cached copy is a last resort and nothing else: no
   * timeout, no racing the network, no "fast enough is good enough". If the
   * network can answer at all, it answers. */
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          // A guide page that was never visited is still reachable, because the
          // home page plus guides.json can render all of them.
          if (req.mode === "navigate") {
            return caches.match(isCrisis(url) ? "/help/" : "/");
          }
          return Response.error();
        });
      })
  );
});

// The page asks for this when it wants the waiting worker to take over, which
// happens when a parent taps the "new version" prompt rather than on its own.
self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

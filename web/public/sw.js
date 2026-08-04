const CACHE_VERSION = "v2";
const STATIC_CACHE = `study-archive-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `study-archive-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const FA_BASE = "https://static.itsmarian.dev/fonts/font-awesome-v7.2.0";

const PRECACHE_URLS = [
    OFFLINE_URL,
    "/manifest.webmanifest",
    "/static/document.css",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    `${FA_BASE}/css/all.min.css`,
    `${FA_BASE}/webfonts/fa-solid-900.woff2`,
    `${FA_BASE}/webfonts/fa-regular-400.woff2`,
];

const NEVER_CACHE_PATTERNS = [/\/api\/.+\/download(?:\?|$)/, /\/api\/ollama\/models/];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

function shouldSkip(url) {
    return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(url));
}

function isImmutableAsset(url) {
    return url.pathname.startsWith("/_next/static/");
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
    }
    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => undefined);
    return cached || (await networkPromise) || Promise.reject(new Error("offline and not cached"));
}

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (!url.protocol.startsWith("http")) return;
    if (shouldSkip(url.pathname + url.search)) return;

    if (request.mode === "navigate") {
        event.respondWith(
            networkFirst(request, RUNTIME_CACHE).catch(async () => {
                const offline = await caches.match(OFFLINE_URL);
                return offline || new Response("Offline", { status: 503 });
            })
        );
        return;
    }

    if (isImmutableAsset(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (
        url.pathname.startsWith("/static/") ||
        url.pathname.startsWith("/icons/") ||
        url.pathname === "/manifest.webmanifest" ||
        url.hostname === "static.itsmarian.dev"
    ) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(
            staleWhileRevalidate(request, RUNTIME_CACHE).catch(
                () => new Response(JSON.stringify({ error: "offline" }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" },
                })
            )
        );
    }
});

self.addEventListener("message", (event) => {
    if (event.data === "study-archive:clear-cache") {
        event.waitUntil(
            caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        );
    }
});
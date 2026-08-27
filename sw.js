const CACHE_NAME = "recipe-viewer-v12";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./styles.css",
    "./main.js",
    "./manifest.json",
    "./sw.js",
    "./jquery-4.0.0.min.js",
    "./anime.esm.min.js",
    "./supabase.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async cache => {

                for (const file of FILES_TO_CACHE) {
                    try {
                        await cache.add(file);
                        console.log("Cached:", file);
                    } catch (error) {
                        console.error("FAILED:", file, error);
                    }
                }

            })
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        clients.claim()
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});
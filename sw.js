const CACHE_NAME = "pcc-verify-v2";

const FILES = [
    "./",
    "./index.html",
    "./manifest.json"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES))
    );

    self.skipWaiting();

});


self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys().then(keys => {

            return Promise.all(

                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))

            );

        })

    );

    self.clients.claim();

});


self.addEventListener("fetch", event => {

    if (event.request.method !== "GET") {
        return;
    }

    // API request cache করবে না
    if (event.request.url.includes("/api/")) {
        return;
    }

    event.respondWith(

        fetch(event.request)
            .then(response => {

                // সফল response cache করে রাখবে
                if (response && response.status === 200) {

                    const responseClone =
                        response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(
                                event.request,
                                responseClone
                            );
                        });

                }

                return response;

            })
            .catch(() => {

                return caches.match(
                    event.request
                );

            })

    );

});

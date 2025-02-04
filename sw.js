let messagePort;

let log = (...args) => (messagePort ? messagePort.postMessage({ type: "LOG", args }) : console.debug("WORKER", ...args));

log("self:", self);

log("executing.");

/* A version number is useful when updating the worker logic,
   allowing you to remove outdated cache entries during the update.
*/
var version = "v1::";

var requested = new Set();

/* These resources will be downloaded and cached by the service worker
   during the installation process. If any resource fails    be downloaded,
   then the service worker won't be installed either.
*/
var offlineFundamentals = ["index.html"];

/* The install event fires when the service worker is first installed.
   You can use this event to prepare the service worker to be able to serve
   files while visitors are offline.
*/
self.addEventListener("install", (event) => {
    log("install event in progress.");
    /* Using event.waitUntil(p) blocks the installation process on the provided
     promise. If the promise is rejected, the service worker won't be installed.
  */
    event.waitUntil(
        /* The caches built-in is a promise-based API that helps you cache responses,
       as well as finding and deleting them.
    */
        caches
            /* You can open a cache by name, and this method returns a promise. We use
         a versioned cache name here so that we can remove old cache entries in
         one fell swoop later, when phasing out an older service worker.
      */
            .open(version + "fundamentals")
            .then((cache) =>
                /* After the cache is opened, we can fill it with the offline fundamentals.
           The method below will add all resources in `offlineFundamentals` to the
           cache, after making requests for them.
        */
                cache.addAll(offlineFundamentals)
            )
            .then(() => log("install completed"))
    );
});

self.addEventListener("message", (event) => {
    const { data } = event;

    if (data) {
        const { type } = data;

        if (type == "INIT_PORT") {
            messagePort = event.ports[0];
            messagePort.onmessage = function (e) {
                log("messagePort.onmessage", e);
            };

            //  log("INIT_PORT", { messagePort }, messagePort.postMessage);
        } else if (type == "REQUESTED") {
            //  log = (...args) => messagePort.postMessage({ type: 'LOG', args });
            //            messagePort.postMessage(data);
        }

        log("message", { type, data });
    }
});

/* The fetch event fires whenever a page controlled by this service worker requests
   a resource. This isn't limited to `fetch` or even XMLHttpRequest. Instead, it
   comprehends even the request for the HTML page on first load, as well as JS and
   CSS resources, fonts, any images, etc.
*/
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const { url } = request;
    const location = url.replace(/^[^\/]*:\/\/[^\/]*/, "");

    log("fetch event in progress.", location);

    /* We should only cache GET requests, and deal with the rest of method in the
     client-side, by handling failed POST,PUT,PATCH,etc. requests.
  */
    if (event.request.method !== "GET") {
        /* If we don't block the event as shown below, then the request will go to
       the network as usual. */
        log("fetch event ignored.", event.request.method, location);
        return;
    }

    requested.add(location);

    /* Similar to event.waitUntil in that it blocks the fetch event on a promise.
     Fulfillment result will be used as the response, and rejection will end in a
     HTTP response indicating failure.
  */
    event.respondWith(
        caches
            /* This method returns a promise that resolves to a cache entry matching
         the request. Once the promise is settled, we can then provide a response
         to the fetch request.
      */
            .match(event.request)
            .then((cached) => {
                /* Even if the response is in our cache, we go to the network as well.
           This pattern is known for producing "eventually fresh" responses,
           where we return cached responses immediately, and meanwhile pull
           a network response and store that in the cache.
           Read more:
           https://ponyfoo.com/articles/progressive-networking-serviceworker
        */
                var networked = fetch(event.request)
                    // We handle the network request with success and failure scenarios.
                    .then(fetchedFromNetwork, unableToResolve)
                    // We should catch errors on the fetchedFromNetwork handler as well.
                    .catch(unableToResolve);

                /* We return the cached response immediately if there is one, and fall
           back to waiting on the network as usual.
        */
                log("fetch event", cached ? "(cached)" : "(network)", location);
                return cached || networked;

                function fetchedFromNetwork(response) {
                    /* We copy the response before replying to the network request.
             This is the response that will be stored on the ServiceWorker cache.
          */
                    var cacheCopy = response.clone();

                    log("fetch response from network.", location);

                    caches
                        // We open a cache to store the response for this request.
                        .open(version + "pages")

                        .then((cache) =>
                            /* We store the response for this request. It'll later become
                 available to caches.match(event.request) calls, when looking
                 for cached responses.
              */
                            {
                                log("request:", event.request, "response:", cacheCopy);
                                cache.put(event.request, cacheCopy).catch(() => {
                                    const { request } = event;
                                    log("error cache.put", { request, cacheCopy });
                                });
                            }
                        )
                        .then(() => log("fetch response stored in cache.", location));

                    // Return the response so that the promise is settled in fulfillment.
                    return response;
                }

                /* When this method is called, it means we were unable to produce a response
           from either the cache or the network. This is our opportunity to produce
           a meaningful response even when all else fails. It's the last chance, so
           you probably want to display a "Service Unavailable" view or a generic
           error response. */
                function unableToResolve() {
                    /* There's a couple of things we can do here.
             - Test the Accept header and then return one of the `offlineFundamentals`
               e.g: `return caches.match('/some/cached/image.png')`
             - You should also consider the origin. It's easier to decide what
               "unavailable" means for requests against your origins than for requests
               against a third party, such as an ad provider.
             - Generate a Response programmaticaly, as shown below, and return that. */

                    log("fetch request failed in both cache and network.");

                    /* Here we're creating a response programmatically. The first parameter is the
             response body, and the second one defines the options for the response. */
                    return new Response("<h1>Service Unavailable</h1>", {
                        status: 503,
                        statusText: "Service Unavailable",
                        headers: new Headers({
                            "Content-Type": "text/html"
                        })
                    });
                }
            })
    );
});

/* The activate event fires after a service worker has been successfully installed.
   It is most useful when phasing out an older version of a service worker, as at
   this point you know that the new worker was installed correctly. In this example,
   we delete old caches that don't match the version in the worker we just finished
   installing. */
self.addEventListener("activate", (event) => {
    /* Just like with the install event, event.waitUntil blocks activate on a promise.
     Activation will fail unless the promise is fulfilled. */
    log("activate event in progress.");

    event.waitUntil(
        caches
            /* This method returns a promise which will resolve to an array of available
         cache keys.  */
            .keys()
            // We return a promise that settles when all outdated caches are deleted.
            .then((keys) =>
                Promise.all(
                    keys
                        // Filter by keys that don't start with the latest version prefix.
                        .filter((key) => !key.startsWith(version))
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => log("activate completed."))
    );
});

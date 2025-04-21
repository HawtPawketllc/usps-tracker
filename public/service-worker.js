self.addEventListener("install", e => {
    console.log("✅ Service Worker installed");
    e.waitUntil(
      caches.open("tracker-cache").then(cache => {
        return cache.addAll(["/tracker.html", "/manifest.json", "/icon.png"]);
      })
    );
  });
  
  self.addEventListener("fetch", e => {
    e.respondWith(
      caches.match(e.request).then(response => {
        return response || fetch(e.request);
      })
    );
  });
  
  self.addEventListener("push", event => {
    const data = event.data?.json() || {};
    event.waitUntil(
      self.registration.showNotification(data.title || "USPS Tracker", {
        body: data.body || "A package was updated.",
        icon: "/icon.png"
      })
    );
  });
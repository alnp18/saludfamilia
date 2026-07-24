const CACHE_NAME = 'saludfamilia-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

// Instalar el SW y cachear assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('Cache error en install:', err);
        // Continuar aunque falle el cacheo de algunos assets
      });
    })
  );
  self.skipWaiting();
});

// Activar el SW y limpiar cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Estrategia de fetch: network-first para datos, cache-first para assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests que no sean HTTP/HTTPS
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Network-first para API (Supabase, etc.)
  if (url.pathname.includes('supabase') || url.pathname.includes('/v1/') || request.method !== 'GET') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cachear respuestas exitosas de GET
          if (request.method === 'GET' && response.status === 200) {
            const cache = caches.open(CACHE_NAME);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Si falla la red, intentar desde caché
          return caches.match(request).then((cached) => {
            return cached || new Response('Sin conexión', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        })
    );
    return;
  }

  // Cache-first para assets estáticos (CSS, JS, SVG, PNG)
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        if (response.status === 200 && request.method === 'GET') {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, response.clone());
          });
        }
        return response;
      }).catch(() => {
        return new Response('Recurso no disponible', {
          status: 404,
          statusText: 'Not Found'
        });
      });
    })
  );
});

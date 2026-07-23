/* Service Worker de Bolsillo.
   El offline completo con precache de lista fija llega en T9; aquí:
   - install:  activarse de inmediato (skipWaiting).
   - activate: tomar control (clients.claim) y limpiar caches viejos.
   - fetch:    network-first REVALIDANDO para todo GET same-origin (HTML, JS, CSS,
               JSON, etc.). Con red, siempre traemos/validamos la versión fresca
               saltándonos la caché HTTP de GitHub Pages (max-age=600) => adiós a
               la ventana de ~10 min de código viejo. Sin red, servimos la última
               copia cacheada como fallback offline básico.
   - Cross-origin (p. ej. https://api.anthropic.com) y no-GET => passthrough puro:
     NUNCA se interceptan (la app llama la API de Claude ahí).
   Rutas relativas: funciona bajo cualquier subpath. */

const CACHE = 'bolsillo-shell-v2';

self.addEventListener('install', () => {
  // Activar esta versión sin esperar a que se cierren las pestañas viejas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Borrar caches de versiones anteriores de Bolsillo.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('bolsillo-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      // Tomar control de las páginas ya abiertas.
      await self.clients.claim();
    })(),
  );
});

/* Network-first revalidando, con fallback a caché.
   - fetch(url, { cache: 'no-cache' }): hace una petición condicional
     (If-None-Match / If-Modified-Since). El servidor responde 304 si no cambió
     (rápido, poco ancho de banda) o 200 con el cuerpo nuevo si cambió. En ambos
     casos el navegador nos entrega una respuesta 200 con cuerpo, saltándose la
     caché HTTP => siempre recibimos el código fresco.
   - Usamos request.url (string) en vez del Request original: pasar un init no
     vacío junto a un Request en modo 'navigate' lanza TypeError en Chromium/
     WebKit. Con la URL evitamos ese caso y el comportamiento es equivalente. */
async function redFrescaConFallback(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresca = await fetch(request.url, { cache: 'no-cache' });
    // Guardamos solo respuestas OK como fallback offline (no 404/500).
    if (fresca && fresca.ok) {
      cache.put(request, fresca.clone());
    }
    return fresca;
  } catch (err) {
    // Sin red: servimos lo último cacheado si existe.
    const cacheada = await cache.match(request);
    if (cacheada) return cacheada;
    // No hay copia => propagamos el error (la app muestra su estado offline).
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Guarda de origen: solo GET same-origin. Todo lo demás pasa directo a la red.
  // Esto deja intactas las llamadas cross-origin (p. ej. api.anthropic.com) y
  // los métodos no-GET (POST del chat de Claude): NO se interceptan.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return; // URL no parseable => passthrough.
  }
  if (url.origin !== self.location.origin) return; // cross-origin => passthrough.

  event.respondWith(redFrescaConFallback(request));
});

// Sube este número en cada publicación: es lo que hace que los clientes actualicen.
const CACHE = 'asistencias-v1';

const ARCHIVOS = [
  './',
  'index.html',
  'main.js',
  'datos.js',
  'estilos.css',
  'manifest.webmanifest',
  'icono.svg',
  'icono-180.png',
  'icono-192.png',
  'icono-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ARCHIVOS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  const clave = request.mode === 'navigate' ? './' : request;
  evento.respondWith(caches.match(clave).then((enCache) => enCache ?? fetch(request)));
});

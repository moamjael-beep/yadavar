// Service Worker for یادآور صوتی PWA
// Provides: offline caching, push notifications, periodic background sync for deadline checking

const CACHE_NAME = 'yadavar-cache-v1';
const IDB_NAME = 'yadavar_db';
const IDB_VERSION = 1;
const STORE_REMINDERS = 'reminders';
const STORE_NOTIF_LOG = 'notif_log';

// App shell - resources to cache on install
const APP_SHELL = [
  './',
  './speech-to-text-reminder.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png',
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css'
];

// ============ IndexedDB helpers (usable from SW) ============
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_REMINDERS)) {
        const store = db.createObjectStore(STORE_REMINDERS, { keyPath: 'id' });
        store.createIndex('deadline', 'deadline', { unique: false });
        store.createIndex('done', 'done', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NOTIF_LOG)) {
        db.createObjectStore(STORE_NOTIF_LOG, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ============ Install: cache app shell ============
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Cache resources one-by-one so partial failures don't break install
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          try {
            const res = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' });
            if (res.ok || res.type === 'opaque') {
              await cache.put(url.startsWith('./') ? new Request(url) : url, res.clone());
            }
          } catch(e) {
            console.warn('[SW] Cache failed for', url, e);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

// ============ Activate: clean old caches ============
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
      await self.clients.claim();
      console.log('[SW] Activated & claimed clients');
    })()
  );
});

// ============ Fetch: cache-first for same-origin, network-first for cross-origin ============
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Skip non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  if (isSameOrigin) {
    // Cache-first for same-origin (app shell)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          // Cache successful responses
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  } else {
    // Stale-while-revalidate for cross-origin (CDN fonts)
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});

// ============ Push: show notification from server push ============
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event.data);
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch(e) { data = { body: event.data.text() }; }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'یادآور صوتی', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-32.png',
      dir: 'rtl',
      lang: 'fa-IR',
      tag: data.tag || 'push-' + Date.now(),
      vibrate: [200, 100, 200],
      data: data.data || {}
    })
  );
});

// ============ Notification click: focus app & expand item ============
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      let client = clientList.find(c => c.focused) || clientList[0];
      if (client) {
        await client.focus();
        // Send message to expand the item if tag contains reminder ID
        const tag = event.notification.tag || '';
        if (tag.startsWith('reminder-')) {
          const id = tag.replace('reminder-', '');
          client.postMessage({ type: 'expand-reminder', id });
        }
      } else {
        await clients.openWindow('./speech-to-text-reminder.html');
      }
    })()
  );
});

// ============ Periodic Background Sync: check deadlines in background ============
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  if (event.tag === 'check-deadlines') {
    event.waitUntil(checkDeadlinesBackground());
  } else {
    // Unknown periodic sync tag
  }
});

// ============ Sync (Background Sync API - for retries) ============
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-deadlines-on-reconnect') {
    event.waitUntil(checkDeadlinesBackground());
  }
});

// ============ Message from page ============
self.addEventListener('message', (event) => {
  console.log('[SW] Message:', event.data);
  if (!event.data) return;
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CHECK_DEADLINES':
      event.waitUntil(checkDeadlinesBackground());
      break;
    case 'TRIGGER_TEST_NOTIFICATION':
      event.waitUntil(
        self.registration.showNotification('یادآور صوتی', {
          body: event.data.body || 'اعلان تست',
          icon: 'icon-192.png',
          badge: 'favicon-32.png',
          dir: 'rtl',
          lang: 'fa-IR',
          tag: 'test-' + Date.now()
        })
      );
      break;
  }
});

// ============ Background deadline check ============
const NOTIF_THRESHOLDS = [
  { minutes: 60 * 24, key: 'd1', label: '۱ روز' },
  { minutes: 60 * 6,  key: 'h6', label: '۶ ساعت' },
  { minutes: 60,      key: 'h1', label: '۱ ساعت' },
  { minutes: 30,      key: 'm30', label: '۳۰ دقیقه' },
  { minutes: 10,      key: 'm10', label: '۱۰ دقیقه' },
  { minutes: 0,       key: 'due', label: 'سررسید' }
];

async function checkDeadlinesBackground() {
  try {
    const reminders = await idbGetAll(STORE_REMINDERS);
    const notifLogEntries = await idbGetAll(STORE_NOTIF_LOG);
    const sentSet = new Set(notifLogEntries.map(e => e.key));
    const now = Date.now();

    console.log(`[SW] Background check: ${reminders.length} reminders, ${sentSet.size} sent notifs`);

    let notificationsSent = 0;
    for (const item of reminders) {
      if (item.done) continue;
      const deadlineMs = new Date(item.deadline).

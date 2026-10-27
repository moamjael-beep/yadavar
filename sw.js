// Service Worker for یادآور صوتی PWA
// Provides: offline caching, push notifications, periodic background sync for deadline checking

const CACHE_NAME = 'yadavar-cache-v7';
const IDB_NAME = 'yadavar_db';
const IDB_VERSION = 2;  // MUST match the page's IDB_VERSION
const STORE_REMINDERS = 'reminders';
const STORE_NOTIF_LOG = 'notif_log';
const STORE_BACKUP = 'backup';  // match the page's backup store

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
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js'
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
      if (!db.objectStoreNames.contains(STORE_BACKUP)) {
        db.createObjectStore(STORE_BACKUP);
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

  // CRITICAL: Bypass cache entirely for reachability check requests.
  // These have a special query param '_rc=1' that tells the SW to always
  // go to the network. If the network fails, return 503 (not cached!).
  // This ensures the page's reachability check ACTUALLY tests the network,
  // not the SW's cache. Without this, offline detection fails because
  // the SW would serve manifest.json from cache even when truly offline.
  if (url.searchParams.has('_rc')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('offline', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  if (isSameOrigin) {
    // Cache-first for same-origin (app shell)
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res.ok) {
            const resClone = res.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, resClone);
          }
          return res;
        } catch(e) {
          // Offline and no cache - return a fallback response, not undefined
          // For HTML pages, return a basic offline page
          const accept = event.request.headers.get('accept') || '';
          if (accept.includes('text/html')) {
            return new Response(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><title>آفلاین</title>' +
              '<body style="font-family:Tahoma;direction:rtl;text-align:center;padding:50px;">' +
              '<h2>این صفحه آفلاین است</h2>' +
              '<p>برای دسترسی به این صفحه، ابتدا آن را در حالت آنلاین باز کنید تا کش شود.</p>' +
              '<p>صفحه اصلی برنامه <a href="./speech-to-text-reminder.html">اینجا</a></p>' +
              '</body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
          // For other resources, return empty response
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
  } else {
    // Stale-while-revalidate for cross-origin (CDN fonts)
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        try {
          const res = await fetch(event.request);
          if (res && (res.ok || res.type === 'opaque')) {
            const resClone = res.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, resClone);
          }
          return res;
        } catch(e) {
          // Offline - return cached if available, otherwise empty response (not undefined)
          return cached || new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
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
    case 'CLEAR_CACHE':
      // Clear ALL caches (including the current one) so the page can reload
      // from the network and get the latest version from GitHub. This is
      // called when the reachability check transitions from offline to online.
      event.waitUntil(
        (async () => {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
            console.log('[SW] All caches cleared:', keys.length, 'caches deleted');
            // Notify all clients that the cache is cleared
            const clientList = await clients.matchAll({ includeUncontrolled: true });
            clientList.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }));
            console.log('[SW] Sent CACHE_CLEARED to', clientList.length, 'clients');
          } catch(e) {
            console.error('[SW] Cache clear failed:', e);
            // Even on failure, notify clients so they can reload
            const clientList = await clients.matchAll({ includeUncontrolled: true });
            clientList.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }));
          }
        })()
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
      const deadlineMs = new Date(item.deadline).getTime();
      if (isNaN(deadlineMs)) continue;
      const remaining = deadlineMs - now;

      for (const t of NOTIF_THRESHOLDS) {
        const triggerMs = t.minutes * 60 * 1000;
        const notifKey = `${item.id}_${t.key}`;
        if (sentSet.has(notifKey)) continue;

        // For background check (less frequent), use wide window (up to 24h past threshold)
        // This way, if SW wakes up hours later, it still catches the notification
        if (remaining <= triggerMs && remaining > triggerMs - 24 * 60 * 60 * 1000) {
          const text = item.text.length > 40 ? item.text.substring(0, 40) + '...' : item.text;
          const isOverdue = remaining <= 0;
          const title = isOverdue
            ? `⚠️ سررسید گذشته: ${text}`
            : `${t.label} تا سررسید: ${text}`;
          const body = isOverdue
            ? 'زمان انجام این یادآور گذشته است. همین حالا بررسی کنید.'
            : 'یادآور شما نزدیک سررسید است';

          try {
            await self.registration.showNotification(title, {
              body: body,
              icon: 'icon-192.png',
              badge: 'favicon-32.png',
              dir: 'rtl',
              lang: 'fa-IR',
              tag: `reminder-${item.id}`,
              vibrate: [200, 100, 200, 100, 200],
              requireInteraction: isOverdue
            });
            await idbPut(STORE_NOTIF_LOG, { key: notifKey, ts: now });
            sentSet.add(notifKey);
            notificationsSent++;
            console.log('[SW] Notification sent for', notifKey);
          } catch(e) {
            console.error('[SW] Failed to show notification:', e);
          }
        }
      }
    }

    // Cleanup: remove notif_log entries older than 30 days
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const oldEntries = notifLogEntries.filter(e => e.ts < cutoff);
    for (const e of oldEntries) {
      await idbDelete(STORE_NOTIF_LOG, e.key);
    }

    console.log(`[SW] Background check done. Sent ${notificationsSent} notifications.`);
    return notificationsSent;
  } catch(e) {
    console.error('[SW] Background check failed:', e);
    return 0;
  }
}

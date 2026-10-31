// ════════════════════════════════════════════════════════════════════
// 🛡️  سرویس ورکر (Service Worker) برنامهٔ «یادآور صوتی»
// ════════════════════════════════════════════════════════════════════
//
// 📌 سرویس ورکر چیست؟
//    سرویس ورکر یک «مغز پنهان» در پس‌زمینهٔ مرورگر است که حتی وقتی
//    صفحه بسته باشد هم کار می‌کند. کارهای مهم این فایل:
//
//    1) ذخیرهٔ آفلاین: وقتی اینترنت قطع است، برنامه از حافظهٔ پنهان
//       (cache) بارگذاری می‌شود و کاربر می‌تواند یادآورهای قبلی را ببیند.
//
//    2) اعلان‌های پس‌زمینه: وقتی سررسید یک یادآور نزدیک می‌شود، حتی اگر
//       مرورگر بسته باشد، یک اعلان به کاربر نشان داده می‌شود.
//
//    3) همگام‌سازی دوره‌ای: هر چند ساعت یک‌بار مرورگر این فایل را بیدار
//       می‌کند تا یادآورها را بررسی کند و اعلان‌های لازم را بفرستد.
//
// ⚠️  نکتهٔ مهم: این فایل کاملاً جدا از صفحهٔ اصلی (HTML) اجرا می‌شود
//    و از طریق «پیام» (postMessage) با صفحه ارتباط برقرار می‌کند.
// ════════════════════════════════════════════════════════════════════


// ────────────────────────────────────────────────────────────────────
// 📦 بخش ۱: تنظیمات پایه و نام‌گذاری
// ────────────────────────────────────────────────────────────────────
// این متغیرها در سراسر فایل استفاده می‌شوند. اگر مقدار یکی را تغییر
// دادید، حتماً همان تغییر را در فایل HTML هم انجام دهید تا صفحه و
// سرویس ورکر با هم هماهنگ بمانند.

// نام «نسخهٔ حافظهٔ پنهان». هر بار که کد را تغییر دادید و در گیت‌هاب
// گذاشتید، این عدد را یکی بالا ببرید (مثلاً v17 → v18) تا مرورگر
// بداند باید فایل‌های جدید را دوباره دانلود کند.
// 🔒 نسخهٔ جدید: اصلاح sticky هدر گروه با عکس پس‌زمینه
const CACHE_NAME = 'yadavar-cache-v43';

// نام پایگاه دادهٔ IndexedDB. این پایگاه داده بین سرویس ورکر و صفحهٔ
// HTML مشترک است و یادآورها + تاریخچهٔ اعلان‌ها را در خود نگه می‌دارد.
const IDB_NAME = 'yadavar_db';

// شمارهٔ نسخهٔ ساختار پایگاه داده. اگر ساختار جدول‌ها را تغییر دادید،
// این عدد را بالا ببرید. ⚠️  حتماً باید با مقدار داخل فایل HTML یکی باشد.
const IDB_VERSION = 2;

// نام سه «جدول» (object store) داخل پایگاه داده:
//   - reminders : یادآورها (یک ردیف برای هر یادآور)
//   - notif_log : تاریخچهٔ اعلان‌های ارسال‌شده (تا دوبار نفرستیم)
//   - backup    : نسخهٔ پشتیبان کامل دیتابیس (برای بازگردانی)
const STORE_REMINDERS = 'reminders';
const STORE_NOTIF_LOG = 'notif_log';
const STORE_BACKUP = 'backup';


// ────────────────────────────────────────────────────────────────────
// 📚 بخش ۲: فهرست منابعی که هنگام نصب، در حافظهٔ پنهان ذخیره می‌شوند
// ────────────────────────────────────────────────────────────────────
// این فهرست «پوستهٔ برنامه» (App Shell) نام دارد. وقتی سرویس ورکر
// برای اولین بار نصب می‌شود، تمام این فایل‌ها را دانلود و ذخیره
// می‌کند تا برنامه حتی بدون اینترنت هم باز شود.
const APP_SHELL = [
  './',                                  // صفحهٔ ریشه
  './speech-to-text-reminder.html',      // صفحهٔ اصلی برنامه
  './manifest.json',                     // فایل معرفی PWA
  './icon-192.png',                      // آیکون‌های مختلف
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png',
  // فونت فارسی وزیرمتن از CDN (در صورت قطع بودن، فونت پیش‌فرض استفاده می‌شود)
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
  // کتابخانهٔ SortableJS برای قابلیت کشیدن و رها کردن (Drag & Drop)
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js'
];


// ════════════════════════════════════════════════════════════════════
// 🗄️  بخش ۳: کمک‌函数های کار با IndexedDB
// ════════════════════════════════════════════════════════════════════
// IndexedDB یک پایگاه دادهٔ داخلی مرورگر است که می‌تواند حجم زیادی
// داده را به‌صورت کلید-مقدار ذخیره کند. این توابع، کارهای رایج را
// ساده می‌کنند: باز کردن پایگاه داده، خواندن همه، افزودن/به‌روزرسانی،
// حذف و پاک‌سازی.
//
// ⚠️  همهٔ این توابع «async» هستند چون کار با دیسک زمان‌بر است و
//    نباید صفحه را متوقف کنند.

// باز کردن (یا ساختن) پایگاه داده. اگر نسخهٔ جدید است، onupgradeneeded
// اجرا می‌شود و جدول‌ها ساخته می‌شوند.
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // جدول یادآورها — با کلید اصلی 'id' و دو ایندکس برای جستجوی سریع
      if (!db.objectStoreNames.contains(STORE_REMINDERS)) {
        const store = db.createObjectStore(STORE_REMINDERS, { keyPath: 'id' });
        store.createIndex('deadline', 'deadline', { unique: false });
        store.createIndex('done', 'done', { unique: false });
      }
      // جدول تاریخچهٔ اعلان‌ها — کلید اصلی 'key' است
      if (!db.objectStoreNames.contains(STORE_NOTIF_LOG)) {
        db.createObjectStore(STORE_NOTIF_LOG, { keyPath: 'key' });
      }
      // جدول پشتیبان — بدون کلید مشخص (کلید به‌صورت دستی داده می‌شود)
      if (!db.objectStoreNames.contains(STORE_BACKUP)) {
        db.createObjectStore(STORE_BACKUP);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// خواندن تمام ردیف‌های یک جدول (به‌صورت آرایه)
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

// افزودن یا به‌روزرسانی یک ردیف در جدول (اگر کلید تکراری باشد، جایگزین می‌شود)
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

// حذف یک ردیف با کلید مشخص
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

// پاک کردن کامل یک جدول (تمام ردیف‌ها حذف می‌شوند)
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


// ════════════════════════════════════════════════════════════════════
// 🚀 بخش ۴: رویداد «نصب» (Install)
// ════════════════════════════════════════════════════════════════════
// این رویداد فقط یک‌بار و هنگام نصب اولیهٔ سرویس ورکر اجرا می‌شود.
// کار اصلی: دانلود تمام فایل‌های «پوستهٔ برنامه» و ذخیره در حافظهٔ پنهان.
// اگر دانلود یکی از فایل‌ها شکست خورد، نصب کل سرویس ورکر شکست نمی‌خورد
// (به‌خاطر Promise.allSettled) — فقط آن فایل ذخیره نمی‌شود.
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // هر فایل را جدا دانلود کن تا شکست یکی، بقیه را خراب نکند
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
      // بلافاصله سرویس ورکر را فعال کن (بدون انتظار برای بسته شدن همهٔ تب‌ها)
      await self.skipWaiting();
    })()
  );
});


// ════════════════════════════════════════════════════════════════════
// ♻️ بخش ۵: رویداد «فعال‌سازی» (Activate)
// ════════════════════════════════════════════════════════════════════
// این رویداد بعد از نصب (و وقتی سرویس ورکر قدیمی از کار افتاد) اجرا
// می‌شود. کار اصلی:
//   1) پاک کردن حافظه‌های پنهان قدیمی (که نامشان با CACHE_NAME فعلی
//      یکی نیست) تا فضای دیسک اشغال نشود.
//   2) به‌دست گرفتن کنترل تمام صفحات باز (clients.claim).
//   3) پیام «بارگذاری دوباره» به تمام صفحات — تا کد جدید را بگیرند.
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...', CACHE_NAME);
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      console.log('[SW] Existing caches:', keys);
      // هر کش که نامش با نسخهٔ فعلی یکی نیست را پاک کن
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
      // کنترل تمام صفحات باز را به‌دست بگیر
      await self.clients.claim();
      console.log('[SW] Activated & claimed clients');
      // ⚠️  مهم: به تمام صفحات باز پیام بده که خودشان را بارگذاری دوباره
      // کنند تا از استراتژی جدید fetch استفاده کنند. بدون این کار، صفحه
      // ممکن است تا بارگذاری بعدی روی رفتار قدیمی سرویس ورکر بماند.
      try {
        const clientList = await clients.matchAll({ includeUncontrolled: true });
        console.log('[SW] Notifying ' + clientList.length + ' clients to reload');
        clientList.forEach(c => c.postMessage({ type: 'RELOAD_PLEASE', version: CACHE_NAME }));
      } catch(e) {
        console.warn('[SW] Failed to notify clients:', e);
      }
    })()
  );
});


// ════════════════════════════════════════════════════════════════════
// 🌐 بخش ۶: رویداد «fetch» — مدیریت تمام درخواست‌های شبکه
// ════════════════════════════════════════════════════════════════════
// هر بار که صفحه چیزی از اینترنت بخواهد (HTML، CSS، JS، تصویر، فونت)،
// این رویداد اجرا می‌شود. ما تصمیم می‌گیریم که:
//   - از حافظهٔ پنهان بخوانیم (سریع، آفلاین)
//   - از شبکه بخوانیم (تازه، همگام با گیت‌هاب)
//   - یا ترکیبی از هر دو
//
// استراتژی ما:
//   1) HTML  → «اول شبکه»: همیشه نسخهٔ تازه را از گیت‌هاب بگیر.
//              اگر اینترنت قطع است، از حافظهٔ پنهان استفاده کن.
//   2) فایل‌های ثابت (JS, CSS, تصاویر) → «اول حافظه»: سریع‌تر است.
//   3) فایل‌های خارجی (CDN فونت) → «اول قدیمی، سپس به‌روزرسانی».
//
// ⚠️  در نسخه‌های قدیمی، HTML «اول حافظه» بود که باعث می‌شد کاربر
//    همیشه کد قدیمی و باگ‌دار را ببیند. به همین دلیل تغییر کرد.
self.addEventListener('fetch', (event) => {
  // فقط درخواست‌های GET را مدیریت می‌کنیم (POST، PUT و ... دست‌نخورده)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // درخواست‌های غیر HTTP (مثل file:// یا chrome-extension://) را رد کن
  if (!url.protocol.startsWith('http')) return;

  // ──────────────────────────────────────────────────────────────────
  // 🚨 استثنای ۱: درخواست‌های بررسی اتصال (_rc=1)
  // ──────────────────────────────────────────────────────────────────
  // این پارامتر مخصوص بررسی «واقعی» اتصال اینترنت است. سرویس ورکر
  // باید حتماً به شبکه برود تا بفهمیم واقعاً آنلاین هستیم یا نه.
  // اگر از حافظهٔ پنهان بخوانیم، تشخیص آفلاین بودن خراب می‌شود.
  if (url.searchParams.has('_rc')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('offline', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🚨 استثنای ۲: درخواست‌های بررسی نسخه (?vcheck= یا ?fresh=)
  // ──────────────────────────────────────────────────────────────────
  // صفحه از این پارامترها استفاده می‌کند تا مطمئن شود در حال اجرای
  // آخرین نسخهٔ HTML است. باید حتماً از شبکه بخوانیم.
  if (url.searchParams.has('vcheck') || url.searchParams.has('fresh')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(res => {
          if (res && res.ok) {
            // نسخهٔ تازه را در حافظهٔ پنهان هم ذخیره کن (بدون کوئری استرینگ)
            const cleanUrl = new Request(url.pathname);
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(cleanUrl, resClone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(c => c || new Response('offline', { status: 503 })))
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // تشخیص اینکه آیا این درخواست HTML است یا فایل ثابت
  // ──────────────────────────────────────────────────────────────────
  const acceptHeader = event.request.headers.get('accept') || '';
  const isHTMLRequest =
    event.request.mode === 'navigate' ||
    acceptHeader.includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/');

  // ──────────────────────────────────────────────────────────────────
  // مسیر ۱: درخواست از همان دامنه (گیت‌هاب)
  // ──────────────────────────────────────────────────────────────────
  if (isSameOrigin) {
    if (isHTMLRequest) {
      // ─── HTML: «اول شبکه» ───
      // اول از گیت‌هاب بخوان تا نسخهٔ تازه باشد. اگر شکست خورد، از
      // حافظهٔ پنهان (آفلاین) استفاده کن. در صورت موفقیت، نسخهٔ تازه
      // را در حافظهٔ پنهان هم ذخیره کن.
      event.respondWith(
        (async () => {
          try {
            const res = await fetch(event.request, { cache: 'no-cache' });
            if (res && (res.ok || res.type === 'opaque')) {
              const resClone = res.clone();
              const cache = await caches.open(CACHE_NAME);
              await cache.put(event.request, resClone);
            }
            return res;
          } catch(e) {
            // شبکه شکست خورد — از حافظهٔ پنهان بخوان
            const cached = await caches.match(event.request);
            if (cached) return cached;
            // نه شبکه، نه حافظه — صفحهٔ آفلاین نشان بده
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
        })()
      );
    } else {
      // ─── فایل‌های ثابت: «اول حافظه» ───
      // اگر در حافظه هست، همان را بده (سریع‌تر). اگر نبود، از شبکه
      // بخوان و در حافظه ذخیره کن برای دفعهٔ بعد.
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
            return new Response('', { status: 504, statusText: 'Offline' });
          }
        })()
      );
    }
  } else {
    // ──────────────────────────────────────────────────────────────────
    // مسیر ۲: درخواست از دامنهٔ دیگر (CDN فونت)
    // ──────────────────────────────────────────────────────────────────
    // «قدیمی را بده، در پس‌زمینه به‌روزرسانی کن»: ابتدا نسخهٔ ذخیره‌شده
    // را بده تا صفحه سریع باز شود، سپس در پس‌زمینه نسخهٔ تازه را
    // دانلود و ذخیره کن برای دفعهٔ بعد.
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
          // آفلاین — اگر حافظه بود همان را بده، وگرنه پاسخ خالی
          return cached || new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
  }
});


// ════════════════════════════════════════════════════════════════════
// 🔔 بخش ۷: رویداد «push» — دریافت اعلان از سرور
// ════════════════════════════════════════════════════════════════════
// اگر سرور (در آینده) بخواهد اعلانی بفرستد، این رویداد اجرا می‌شود.
// در حال حاضر سرور فعال نیست، اما کد آماده است.
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
      dir: 'rtl',           // راست‌چین (فارسی)
      lang: 'fa-IR',
      tag: data.tag || 'push-' + Date.now(),
      vibrate: [200, 100, 200],  // الگوی لرزش (در گوشی‌های پشتیبان)
      data: data.data || {}
    })
  );
});


// ════════════════════════════════════════════════════════════════════
// 👆 بخش ۸: رویداد «کلیک روی اعلان»
// ════════════════════════════════════════════════════════════════════
// وقتی کاربر روی یک اعلان کلیک می‌کند:
//   1) اگر برنامه باز است، آن را متمرکز (focus) کن.
//   2) اگر اعلان مربوط به یک یادآور خاص است (تگ با 'reminder-' شروع
//      می‌شود)، پیامی به صفحه بفرست تا آن یادآور باز/گسترش یابد.
//   3) اگر برنامه بسته است، آن را باز کن.
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      let client = clientList.find(c => c.focused) || clientList[0];
      if (client) {
        await client.focus();
        // اگر تگ اعلان با 'reminder-' شروع شود، شناسهٔ یادآور را استخراج کن
        // و به صفحه بفرست تا آن را گسترش دهد (باز کند).
        const tag = event.notification.tag || '';
        if (tag.startsWith('reminder-')) {
          const id = tag.replace('reminder-', '');
          client.postMessage({ type: 'expand-reminder', id });
        }
      } else {
        // برنامه بسته است — آن را باز کن
        await clients.openWindow('./speech-to-text-reminder.html');
      }
    })()
  );
});


// ════════════════════════════════════════════════════════════════════
// ⏰ بخش ۹: همگام‌سازی پس‌زمینهٔ دوره‌ای (Periodic Background Sync)
// ════════════════════════════════════════════════════════════════════
// مرورگر (در کروم دسکتاپ/اندروید) هر چند ساعت یک‌بار سرویس ورکر را
// بیدار می‌کند تا یادآورها را بررسی کند و اعلان‌های لازم را بفرستد.
// این کار حتی وقتی برنامه بسته باشد هم انجام می‌شود.
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  if (event.tag === 'check-deadlines') {
    event.waitUntil(checkDeadlinesBackground());
  } else {
    // تگ ناشناخته — کاری نکن
  }
});


// ════════════════════════════════════════════════════════════════════
// 🔁 بخش ۱۰: همگام‌سازی پس‌زمینه (Background Sync) — برای زمان اتصال دوباره
// ════════════════════════════════════════════════════════════════════
// وقتی اینترنت قطع است و دوباره وصل می‌شود، این رویداد اجرا می‌شود.
// کاربرد: بررسی یادآورهایی که در مدت آفلاین بودن، سررسیدشان گذشته.
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-deadlines-on-reconnect') {
    event.waitUntil(checkDeadlinesBackground());
  }
});


// ════════════════════════════════════════════════════════════════════
// 📨 بخش ۱۱: دریافت پیام از صفحهٔ HTML
// ════════════════════════════════════════════════════════════════════
// صفحهٔ HTML از طریق navigator.serviceWorker.controller.postMessage
// پیام‌هایی به این سرویس ورکر می‌فرستد. ما بر اساس «type» پیام،
// کار مناسب را انجام می‌دهیم.
self.addEventListener('message', (event) => {
  console.log('[SW] Message:', event.data);
  if (!event.data) return;
  switch (event.data.type) {
    // پیام «الان فعال شو» — وقتی نسخهٔ جدیدی منتظر فعال‌سازی است
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // پیام «یادآورها را بررسی کن» — از طرف صفحه فراخوانی می‌شود
    case 'CHECK_DEADLINES':
      event.waitUntil(checkDeadlinesBackground());
      break;

    // پیام «اعلان تست بفرست» — برای تست دستی
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

    // پیام «تمام حافظه‌های پنهان را پاک کن» — وقتی اتصال از آفلاین
    // به آنلاین برمی‌گردد، صفحه این پیام را می‌فرستد تا کاربر حتماً
    // نسخهٔ تازهٔ گیت‌هاب را ببیند.
    case 'CLEAR_CACHE':
      event.waitUntil(
        (async () => {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
            console.log('[SW] All caches cleared:', keys.length, 'caches deleted');
            // به تمام صفحات اطلاع بده که حافظه پاک شد
            const clientList = await clients.matchAll({ includeUncontrolled: true });
            clientList.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }));
            console.log('[SW] Sent CACHE_CLEARED to', clientList.length, 'clients');
          } catch(e) {
            console.error('[SW] Cache clear failed:', e);
            // حتی در صورت شکست، به صفحات اطلاع بده تا بارگذاری دوباره کنند
            const clientList = await clients.matchAll({ includeUncontrolled: true });
            clientList.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }));
          }
        })()
      );
      break;
  }
});


// ════════════════════════════════════════════════════════════════════
// 🕐 بخش ۱۲: بررسی سررسیدها در پس‌زمینه
// ════════════════════════════════════════════════════════════════════
// این تابع از تمام یادآورها می‌گذرد و برای هر کدام که به سررسیدش
// نزدیک شده (یا گذشته)، یک اعلان می‌فرستد. اعلان‌های قبلاً ارسال‌شده
// را دوبار نمی‌فرستد (به‌ کمک STORE_NOTIF_LOG).

// سطوح زمانی برای اعلان: هر کدام فقط یک‌بار فرستاده می‌شوند.
//   d1  : یک روز قبل
//   h6  : شش ساعت قبل
//   h1  : یک ساعت قبل
//   m30 : سی دقیقه قبل
//   m10 : ده دقیقه قبل
//   due : در لحظهٔ سررسید
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
    // ۱) تمام یادآورها و تاریخچهٔ اعلان‌ها را از پایگاه داده بخوان
    const reminders = await idbGetAll(STORE_REMINDERS);
    const notifLogEntries = await idbGetAll(STORE_NOTIF_LOG);
    const sentSet = new Set(notifLogEntries.map(e => e.key));
    const now = Date.now();

    console.log(`[SW] Background check: ${reminders.length} reminders, ${sentSet.size} sent notifs`);

    let notificationsSent = 0;

    // ۲) روی هر یادآور و هر سطح زمانی بگذر
    for (const item of reminders) {
      // یادآورهای انجام‌شده را رد کن
      if (item.done) continue;
      const deadlineMs = new Date(item.deadline).getTime();
      if (isNaN(deadlineMs)) continue;
      const remaining = deadlineMs - now;

      for (const t of NOTIF_THRESHOLDS) {
        const triggerMs = t.minutes * 60 * 1000;
        const notifKey = `${item.id}_${t.key}`;
        // اگر این اعلان قبلاً فرستاده شده، رد کن
        if (sentSet.has(notifKey)) continue;

        // در بررسی پس‌زمینه (که کم‌تر اجرا می‌شود)، پنجرهٔ زمانی وسیع‌تر
        // می‌گیریم (تا ۲۴ ساعت بعد از آستانه) تا اگر سرویس ورکر دیر بیدار
        // شد، اعلان از قلم نیفتد.
        if (remaining <= triggerMs && remaining > triggerMs - 24 * 60 * 60 * 1000) {
          // متن کوتاه برای عنوان اعلان (حداکثر ۴۰ کاراکتر)
          const text = item.text.length > 40 ? item.text.substring(0, 40) + '...' : item.text;
          const isOverdue = remaining <= 0;
          const title = isOverdue
            ? `⚠️ سررسید گذشته: ${text}`
            : `${t.label} تا سررسید: ${text}`;
          const body = isOverdue
            ? 'زمان انجام این یادآور گذشته است. همین حالا بررسی کنید.'
            : 'یادآور شما نزدیک سررسید است';

          // اعلان را نمایش بده
          try {
            await self.registration.showNotification(title, {
              body: body,
              icon: 'icon-192.png',
              badge: 'favicon-32.png',
              dir: 'rtl',
              lang: 'fa-IR',
              tag: `reminder-${item.id}`,
              vibrate: [200, 100, 200, 100, 200],
              // اعلان‌های «سررسید گذشته» تا زمان کلیک کاربر پنهان نمی‌شوند
              requireInteraction: isOverdue
            });
            // کلید را در تاریخچه ثبت کن تا دوبار فرستاده نشود
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

    // ۳) پاک‌سازی: ردیف‌های تاریخچهٔ قدیمی‌تر از ۳۰ روز را حذف کن
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

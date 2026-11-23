// IndexedDB wrapper for calendar data
const DB_NAME = 'WorkCalendarDB';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('days')) {
        const store = db.createObjectStore('days', { keyPath: 'date' });
        store.createIndex('byMonth', 'month', { unique: false });
        store.createIndex('byTopic', 'topic', { unique: false });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('byTopic', 'topic', { unique: false });
        store.createIndex('byMonth', 'month', { unique: false });
        store.createIndex('byReceived', 'receivedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('patterns')) {
        db.createObjectStore('patterns', { keyPath: 'id' });
      }
    };
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export async function getSetting(key, defaultValue = null) {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('settings', 'readonly');
    const req = t.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
    req.onerror = () => resolve(defaultValue);
  });
}

export async function setSetting(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('settings', 'readwrite');
    t.objectStore('settings').put({ key, value });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getDay(date) {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('days', 'readonly');
    const req = t.objectStore('days').get(date);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function putDay(day) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('days', 'readwrite');
    t.objectStore('days').put(day);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getDaysByMonth(yearMonth, topic) {
  // yearMonth = 'YYYY-MM'
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('days', 'readonly');
    const store = t.objectStore('days');
    const index = store.index('byMonth');
    const range = IDBKeyRange.only(yearMonth);
    const req = index.getAll(range);
    req.onsuccess = () => {
      let days = req.result || [];
      if (topic) days = days.filter(d => d.topic === topic);
      resolve(days);
    };
    req.onerror = () => resolve([]);
  });
}

export async function putMessage(msg) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readwrite');
    t.objectStore('messages').put(msg);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function hasMessage(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('messages', 'readonly');
    const req = t.objectStore('messages').get(id);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
}

export async function getMessagesByMonth(yearMonth, topic) {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('messages', 'readonly');
    const index = t.objectStore('messages').index('byMonth');
    const req = index.getAll(IDBKeyRange.only(yearMonth));
    req.onsuccess = () => {
      let msgs = req.result || [];
      if (topic) msgs = msgs.filter(m => m.topic === topic);
      msgs.sort((a, b) => b.receivedAt - a.receivedAt);
      resolve(msgs);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getAllPatterns() {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('patterns', 'readonly');
    const req = t.objectStore('patterns').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function putPattern(p) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('patterns', 'readwrite');
    t.objectStore('patterns').put(p);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deletePattern(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('patterns', 'readwrite');
    t.objectStore('patterns').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function exportAllData() {
  const db = await openDB();
  const data = { version: 1, exportedAt: new Date().toISOString() };
  const stores = ['settings', 'days', 'messages', 'patterns'];
  for (const name of stores) {
    data[name] = await new Promise((resolve) => {
      const t = db.transaction(name, 'readonly');
      const req = t.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
  return data;
}

export async function importAllData(data) {
  if (!data || !data.version) throw new Error('Invalid backup');
  const db = await openDB();
  const stores = ['settings', 'days', 'messages', 'patterns'];
  for (const name of stores) {
    if (!Array.isArray(data[name])) continue;
    await new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite');
      const store = t.objectStore(name);
      store.clear();
      for (const item of data[name]) store.put(item);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
}

export async function clearAllData() {
  const db = await openDB();
  const stores = ['settings', 'days', 'messages', 'patterns'];
  for (const name of stores) {
    await new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite');
      t.objectStore(name).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
}

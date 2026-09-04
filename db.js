// IndexedDB wrapper for expense records and app settings.
const DB_NAME = 'expense-memo-db';
const DB_VERSION = 1;
const STORE_EXPENSES = 'expenses';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_EXPENSES)) {
        const store = db.createObjectStore(STORE_EXPENSES, { keyPath: 'id' });
        store.createIndex('month', 'month', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function monthKey(dateStr) {
  // dateStr: 'YYYY-MM-DD' -> 'YYYY-MM'
  return dateStr ? dateStr.slice(0, 7) : '';
}

const ExpenseDB = {
  async add(expense) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      const record = { ...expense, id: expense.id || crypto.randomUUID(), month: monthKey(expense.date) };
      tx.objectStore(STORE_EXPENSES).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },

  async update(expense) {
    return this.add(expense);
  },

  async remove(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      tx.objectStore(STORE_EXPENSES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getByMonth(month) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const idx = tx.objectStore(STORE_EXPENSES).index('month');
      const req = idx.getAll(month);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.date.localeCompare(b.date)));
      req.onerror = () => reject(req.error);
    });
  },

  async getAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const req = tx.objectStore(STORE_EXPENSES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllMonths() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const req = tx.objectStore(STORE_EXPENSES).getAll();
      req.onsuccess = () => {
        const months = new Set((req.result || []).map(r => r.month));
        resolve(months);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getSetting(key, fallback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const req = tx.objectStore(STORE_SETTINGS).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  },

  async setSetting(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_SETTINGS).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// Reads and writes for the app. `createData(db)` takes a Firestore instance, so tests can pass their own.
// Reads fall back to what is saved on the phone, then to sample content, when the database can't be reached.
// They use the "FromServer" calls on purpose: the plain ones answer an offline query with an empty list instead of an error.
import {
  collection, doc, getDocFromServer, getDocsFromServer, query, where, orderBy, setDoc, deleteDoc, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { backupVerse, sampleAnnouncements, sampleEvents } from './sample-data.js';
import { dateKey } from './util.js';

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Firestore document -> plain object (times as epoch milliseconds, so it can be saved as JSON).
const readers = {
  announcements: (id, d) => clean({ id, title: d.title, body: d.body, pinned: !!d.pinned, published: !!d.published, publishedAt: ms(d.publishedAt), expiresAt: ms(d.expiresAt), linkUrl: d.linkUrl, linkLabel: d.linkLabel, sample: d.sample }),
  verses: (id, d) => clean({ id, reference: d.reference, text: d.text, translation: d.translation, sample: d.sample }),
  events: (id, d) => clean({
    id, title: d.title, start: ms(d.start), end: ms(d.end), allDay: d.allDay, location: d.location, place: d.place, type: d.type, host: d.host,
    description: d.description, cover: d.cover, pinned: d.pinned, registerUrl: d.registerUrl, requireApproval: d.requireApproval, price: d.price,
    capacity: d.capacity, notifyFollowers: d.notifyFollowers, going: d.going, published: !!d.published, sample: d.sample, createdAt: ms(d.createdAt),
  }),
  staff: (id, d) => clean({ id, role: d.role, name: d.name }),
};

// Form values -> document fields. Fields left empty are left out, which is what the rules expect.
const writers = {
  announcements: (v) => ({ title: v.title, body: v.body ?? '', pinned: !!v.pinned, published: !!v.published, publishedAt: Timestamp.fromMillis(v.publishedAt), ...clean({ linkUrl: v.linkUrl, linkLabel: v.linkLabel }) }),
  verses: (v) => ({ reference: v.reference, text: v.text, translation: v.translation }),
  events: (v) => ({
    title: v.title, start: Timestamp.fromMillis(v.start), ...(v.end ? { end: Timestamp.fromMillis(v.end) } : {}), location: v.location, type: v.type,
    ...clean({ place: v.place, host: v.host, description: v.description, cover: v.cover, registerUrl: v.registerUrl, price: v.price, capacity: v.capacity }),
    ...(v.requireApproval ? { requireApproval: true } : {}), ...(v.pinned ? { pinned: true } : {}), notifyFollowers: !!v.notifyFollowers,
    ...(v.createdAt ? { createdAt: Timestamp.fromMillis(v.createdAt) } : {}), published: !!v.published,
  }),
  staff: (v) => ({ role: v.role, ...clean({ name: v.name }) }),
};

const SORTS = {
  announcements: (a, b) => b.publishedAt - a.publishedAt,
  verses: (a, b) => (a.id < b.id ? 1 : -1),
  events: (a, b) => b.start - a.start,
  staff: (a, b) => (a.id < b.id ? -1 : 1),
};

const CACHE_PREFIX = 'lc:v1:';
function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* storage may be full or blocked */ }
}

function withTimeout(promise, limit) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), limit); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createData(db, { now = Date.now, timeoutMs = 8000 } = {}) {
  // Returns { value, source }, where source is 'live', 'cache' (saved on the phone) or 'fallback'.
  async function load(cacheKey, fetcher, fromCache, fallback) {
    try {
      const value = await withTimeout(fetcher(), timeoutMs);
      cacheSet(cacheKey, value);
      return { value, source: 'live' };
    } catch (error) {
      console.warn(`Could not load ${cacheKey}:`, error.code || error.message);
      const cached = cacheGet(cacheKey);
      return cached ? { value: fromCache(cached), source: 'cache' } : { value: fallback(), source: 'fallback' };
    }
  }

  const inRange = (from, to) => (e) => e.start >= from && e.start < to;

  return {
    // The verse scheduled for a date (Singapore), or a backup verse when none is scheduled.
    getVerse(key = dateKey(now())) {
      return load(`verse:${key}`, async () => {
        const snap = await getDocFromServer(doc(db, 'verses', key));
        return snap.exists() ? readers.verses(snap.id, snap.data()) : backupVerse(key);
      }, (v) => v, () => backupVerse(key));
    },

    // Published announcements, pinned first, newest first, expired ones left out.
    getAnnouncements() {
      const visible = (list) => list.filter((a) => !a.expiresAt || a.expiresAt > now());
      return load('announcements', async () => {
        const snap = await getDocsFromServer(query(collection(db, 'announcements'), where('published', '==', true), orderBy('pinned', 'desc'), orderBy('publishedAt', 'desc')));
        return visible(snap.docs.map((d) => readers.announcements(d.id, d.data())));
      }, visible, () => sampleAnnouncements(now()));
    },

    // Published events that start in [from, to), as epoch milliseconds, soonest first.
    async getEvents({ from, to, key = 'events' }) {
      const result = await load(key, async () => {
        const snap = await getDocsFromServer(query(collection(db, 'events'), where('published', '==', true), where('start', '>=', Timestamp.fromMillis(from)), where('start', '<', Timestamp.fromMillis(to)), orderBy('start')));
        return snap.docs.map((d) => readers.events(d.id, d.data()));
      }, (list) => list, () => sampleEvents(now()));
      const value = result.value.filter(inRange(from, to)).sort((a, b) => a.start - b.start);
      return { ...result, value };
    },

    // One event by id. `value` is null when it does not exist or is not public.
    getEvent(id) {
      return load(`event:${id}`, async () => {
        const snap = await getDocFromServer(doc(db, 'events', id));
        return snap.exists() ? readers.events(snap.id, snap.data()) : null;
      }, (v) => v, () => sampleEvents(now()).find((e) => e.id === id) ?? null);
    },

    // The pinned event (the conference), if any: the earliest pinned event that has not finished.
    async getPinnedEvent() {
      const result = await load('pinned', async () => {
        const snap = await getDocsFromServer(query(collection(db, 'events'), where('published', '==', true), where('pinned', '==', true)));
        return snap.docs.map((d) => readers.events(d.id, d.data()));
      }, (list) => list, () => sampleEvents(now()).filter((e) => e.pinned));
      const current = result.value.filter((e) => (e.end ?? e.start + 3600000) > now()).sort((a, b) => a.start - b.start)[0] ?? null;
      return { ...result, value: current };
    },

    // For signed-in staff. The security rules decide who may do what.
    admin: {
      async getStaffEntry(email) {
        const snap = await getDocFromServer(doc(db, 'staff', email.toLowerCase()));
        return snap.exists() ? readers.staff(snap.id, snap.data()) : null;
      },
      async list(col) {
        const snap = await getDocsFromServer(collection(db, col));
        return snap.docs.map((d) => readers[col](d.id, d.data())).sort(SORTS[col]);
      },
      // Saving replaces the document, so an edited sample item stops being marked as sample.
      async save(col, email, values, id) {
        const ref = id ? doc(db, col, id) : doc(collection(db, col));
        const created = col === 'events' && !id && !values.createdAt ? { createdAt: serverTimestamp() } : {};
        await setDoc(ref, { ...writers[col](values), ...created, updatedBy: email.toLowerCase(), updatedAt: serverTimestamp() });
        return ref.id;
      },
      remove: (col, id) => deleteDoc(doc(db, col, id)),
    },
  };
}

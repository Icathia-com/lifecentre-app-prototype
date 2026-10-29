// Security rules tests. Run with: npm test (starts the Firestore emulator, needs Java 21+).
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, orderBy, Timestamp,
} from 'firebase/firestore';
import { seedDocs } from '../seed/seed.mjs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const T = (iso) => Timestamp.fromDate(new Date(iso));

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'lifecentre-app', firestore: { rules } });
});
after(async () => { await env.cleanup(); });

const ADMIN = 'admin@lifecentre.sg';
const STAFF = 'staff@lifecentre.sg';
const LEADER = 'leader@lifecentre.sg';

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', ADMIN), { role: 'admin', updatedBy: ADMIN });
    await setDoc(doc(db, 'staff', STAFF), { role: 'staff', updatedBy: ADMIN });
    await setDoc(doc(db, 'staff', LEADER), { role: 'leader', updatedBy: ADMIN });
    await setDoc(doc(db, 'announcements', 'pub'), { title: 'Public', body: 'b', pinned: false, published: true, publishedAt: T('2026-10-27T00:00:00Z'), updatedBy: STAFF });
    await setDoc(doc(db, 'announcements', 'draft'), { title: 'Draft', body: 'b', pinned: false, published: false, publishedAt: T('2026-10-27T00:00:00Z'), updatedBy: STAFF });
    await setDoc(doc(db, 'verses', '2026-10-27'), { reference: 'Psalm 46:10', text: 'Be still, and know that I am God.', translation: 'KJV', updatedBy: STAFF });
    await setDoc(doc(db, 'events', 'pub'), { title: 'Cell group', start: T('2026-10-30T11:30:00Z'), location: 'yishun', type: 'cell', published: true, updatedBy: STAFF });
    await setDoc(doc(db, 'events', 'draft'), { title: 'Draft event', start: T('2026-10-31T11:30:00Z'), location: 'tuas', type: 'special', published: false, updatedBy: STAFF });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const user = (email, verified = true) => env.authenticatedContext(`u-${email}`, { email, email_verified: verified }).firestore();

const announcement = (email, extra = {}) => ({ title: 'New', body: 'Body', pinned: false, published: true, publishedAt: T('2026-10-28T00:00:00Z'), updatedBy: email, ...extra });
const verse = (email, extra = {}) => ({ reference: 'John 3:16', text: 'For God so loved the world…', translation: 'WEB', updatedBy: email, ...extra });
const event = (email, extra = {}) => ({ title: 'Prayer', start: T('2026-11-04T11:30:00Z'), location: 'yishun', type: 'prayer', published: true, updatedBy: email, ...extra });

describe('public (signed out)', () => {
  it('reads a published announcement', () => assertSucceeds(getDoc(doc(anon(), 'announcements', 'pub'))));
  it('lists published announcements with the published filter', () =>
    assertSucceeds(getDocs(query(collection(anon(), 'announcements'), where('published', '==', true), orderBy('publishedAt', 'desc')))));
  it('cannot list announcements without the published filter', () => assertFails(getDocs(collection(anon(), 'announcements'))));
  it('cannot read a draft announcement', () => assertFails(getDoc(doc(anon(), 'announcements', 'draft'))));
  it('reads a verse', () => assertSucceeds(getDoc(doc(anon(), 'verses', '2026-10-27'))));
  it('reads a published event, not a draft', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'events', 'pub')));
    await assertFails(getDoc(doc(anon(), 'events', 'draft')));
  });
  it('cannot write anything', async () => {
    await assertFails(setDoc(doc(anon(), 'announcements', 'x'), announcement(STAFF)));
    await assertFails(setDoc(doc(anon(), 'verses', '2026-11-01'), verse(STAFF)));
    await assertFails(setDoc(doc(anon(), 'events', 'x'), event(STAFF)));
    await assertFails(deleteDoc(doc(anon(), 'announcements', 'pub')));
  });
  it('cannot read the staff list', () => assertFails(getDocs(collection(anon(), 'staff'))));
});

describe('signed in but not on the staff list', () => {
  it('cannot write', async () => {
    const db = user('visitor@example.com');
    await assertFails(setDoc(doc(db, 'announcements', 'x'), announcement('visitor@example.com')));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-01'), verse('visitor@example.com')));
  });
  it('cannot add themselves to the staff list', () =>
    assertFails(setDoc(doc(user('visitor@example.com'), 'staff', 'visitor@example.com'), { role: 'admin', updatedBy: 'visitor@example.com' })));
  it('cannot read a draft', () => assertFails(getDoc(doc(user('visitor@example.com'), 'announcements', 'draft'))));
  it('can read their own (missing) staff entry, which tells the app they are not staff', async () => {
    const snap = await assertSucceeds(getDoc(doc(user('visitor@example.com'), 'staff', 'visitor@example.com')));
    if (snap.exists()) throw new Error('should not exist');
  });
});

describe('staff', () => {
  it('can create, edit and delete an announcement', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'announcements', 'new'), announcement(STAFF)));
    await assertSucceeds(setDoc(doc(db, 'announcements', 'new'), announcement(STAFF, { title: 'Edited', pinned: true, linkUrl: 'https://example.org/register', linkLabel: 'Register' })));
    await assertSucceeds(deleteDoc(doc(db, 'announcements', 'new')));
  });
  it('can read drafts and list everything', async () => {
    const db = user(STAFF);
    await assertSucceeds(getDoc(doc(db, 'announcements', 'draft')));
    await assertSucceeds(getDocs(collection(db, 'announcements')));
    await assertSucceeds(getDocs(collection(db, 'events')));
  });
  it('is matched case-insensitively and needs a verified email', async () => {
    await assertSucceeds(setDoc(doc(user('Staff@LifeCentre.SG'), 'announcements', 'c'), announcement('staff@lifecentre.sg')));
    await assertFails(setDoc(doc(user(STAFF, false), 'announcements', 'c2'), announcement(STAFF)));
  });
  it('cannot write an announcement with bad data', async () => {
    const db = user(STAFF);
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { title: '' })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { title: 'x'.repeat(121) })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { extra: 1 })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { published: 'yes' })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { linkUrl: 'javascript:alert(1)' })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(STAFF, { linkUrl: 'http://example.org' })));
    await assertFails(setDoc(doc(db, 'announcements', 'a'), announcement(ADMIN)));
    const { title, ...noTitle } = announcement(STAFF);
    await assertFails(setDoc(doc(db, 'announcements', 'a'), noTitle));
  });
  it('can schedule a verse for a date, only with a date id and KJV or WEB', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-01'), verse(STAFF)));
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-02'), verse(STAFF, { translation: 'KJV', sample: true })));
    await assertFails(setDoc(doc(db, 'verses', 'tomorrow'), verse(STAFF)));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-03'), verse(STAFF, { translation: 'NIV' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-03'), verse(STAFF, { text: '' })));
  });
  it('can post an event, and the end cannot be before the start', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'events', 'n1'), event(STAFF, { end: T('2026-11-04T13:00:00Z'), location: 'other', place: 'Main hall', host: 'Prayer Ministry', description: 'All welcome' })));
    await assertFails(setDoc(doc(db, 'events', 'n2'), event(STAFF, { end: T('2026-11-04T10:00:00Z') })));
    await assertFails(setDoc(doc(db, 'events', 'n3'), event(STAFF, { published: 'yes' })));
  });
  it('needs a location and a type from the design lists on every event', async () => {
    const db = user(STAFF);
    for (const location of ['yishun', 'tuas', 'kranji', 'pasir', 'other']) await assertSucceeds(setDoc(doc(db, 'events', `loc-${location}`), event(STAFF, { location })));
    for (const type of ['service', 'kids', 'youth', 'cell', 'prayer', 'special']) await assertSucceeds(setDoc(doc(db, 'events', `type-${type}`), event(STAFF, { type })));
    await assertFails(setDoc(doc(db, 'events', 'b1'), event(STAFF, { location: 'Main hall' })));
    await assertFails(setDoc(doc(db, 'events', 'b2'), event(STAFF, { type: 'party' })));
    const { location, ...noLocation } = event(STAFF);
    const { type, ...noType } = event(STAFF);
    await assertFails(setDoc(doc(db, 'events', 'b3'), noLocation));
    await assertFails(setDoc(doc(db, 'events', 'b4'), noType));
  });
  it('accepts the create-event options, and refuses bad ones', async () => {
    const db = user(STAFF);
    const cover = { from: '#2A1B6B', to: '#7A3FD6', label: 'PRAYER &\nWORSHIP' };
    await assertSucceeds(setDoc(doc(db, 'events', 'full'), event(STAFF, {
      host: 'Prayer Ministry', cover, pinned: true, registerUrl: 'https://example.org/register', requireApproval: true, price: 15, capacity: 100,
      notifyFollowers: true, going: 24, createdAt: T('2026-10-27T00:00:00Z'), sample: true,
    })));
    await assertSucceeds(setDoc(doc(db, 'events', 'photo'), event(STAFF, { cover: { ...cover, photo: `data:image/jpeg;base64,${'A'.repeat(1000)}` } })));
    const bad = [
      { cover: { ...cover, from: 'blue' } },
      { cover: { ...cover, extra: 1 } },
      { cover: { from: '#2A1B6B', to: '#7A3FD6' } },
      { cover: { ...cover, label: 'x'.repeat(41) } },
      { cover: { ...cover, photo: `data:image/jpeg;base64,${'A'.repeat(140000)}` } },
      { cover: { ...cover, photo: `data:text/html;base64,${'A'.repeat(100)}` } },
      { cover: { ...cover, photo: 'https://example.org/a.jpg' } },
      { registerUrl: 'http://example.org' },
      { registerUrl: 'javascript:alert(1)' },
      { price: 0 }, { price: -5 }, { price: '10' }, { price: 1.5 },
      { capacity: 0 }, { capacity: '50' },
      { pinned: 'yes' }, { notifyFollowers: 1 }, { going: -1 }, { host: 'x'.repeat(81) }, { place: 'x'.repeat(121) }, { surprise: true },
    ];
    for (const extra of bad) await assertFails(setDoc(doc(db, 'events', 'bad'), event(STAFF, extra)));
  });
  it('cannot change the staff list, and can read only their own entry', async () => {
    const db = user(STAFF);
    await assertFails(setDoc(doc(db, 'staff', 'new@lifecentre.sg'), { role: 'staff', updatedBy: STAFF }));
    await assertFails(setDoc(doc(db, 'staff', STAFF), { role: 'admin', updatedBy: STAFF }));
    await assertSucceeds(getDoc(doc(db, 'staff', STAFF)));
    await assertFails(getDoc(doc(db, 'staff', ADMIN)));
    await assertFails(getDocs(collection(db, 'staff')));
  });
});

describe('leader (on the staff list, but cannot post)', () => {
  it('is recognised: reads their own staff entry, but not other entries or the list', async () => {
    const db = user(LEADER);
    const snap = await assertSucceeds(getDoc(doc(db, 'staff', LEADER)));
    assert.equal(snap.data().role, 'leader');
    await assertFails(getDoc(doc(db, 'staff', ADMIN)));
    await assertFails(getDocs(collection(db, 'staff')));
  });
  it('reads exactly what the public reads', async () => {
    const db = user(LEADER);
    await assertSucceeds(getDoc(doc(db, 'announcements', 'pub')));
    await assertSucceeds(getDoc(doc(db, 'verses', '2026-10-27')));
    await assertSucceeds(getDoc(doc(db, 'events', 'pub')));
    await assertSucceeds(getDocs(query(collection(db, 'announcements'), where('published', '==', true))));
  });
  it('cannot read unpublished drafts or list without the published filter', async () => {
    const db = user(LEADER);
    await assertFails(getDoc(doc(db, 'announcements', 'draft')));
    await assertFails(getDoc(doc(db, 'events', 'draft')));
    await assertFails(getDocs(collection(db, 'announcements')));
    await assertFails(getDocs(collection(db, 'events')));
  });
  it('cannot create, edit or delete announcements, verses or events', async () => {
    const db = user(LEADER);
    await assertFails(setDoc(doc(db, 'announcements', 'new'), announcement(LEADER)));
    await assertFails(setDoc(doc(db, 'announcements', 'pub'), announcement(LEADER)));
    await assertFails(deleteDoc(doc(db, 'announcements', 'pub')));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-01'), verse(LEADER)));
    await assertFails(setDoc(doc(db, 'verses', '2026-10-27'), verse(LEADER)));
    await assertFails(deleteDoc(doc(db, 'verses', '2026-10-27')));
    await assertFails(setDoc(doc(db, 'events', 'new'), event(LEADER)));
    await assertFails(deleteDoc(doc(db, 'events', 'pub')));
  });
  it('cannot change the staff list, including their own role', async () => {
    const db = user(LEADER);
    await assertFails(setDoc(doc(db, 'staff', 'new@lifecentre.sg'), { role: 'staff', updatedBy: LEADER }));
    await assertFails(setDoc(doc(db, 'staff', LEADER), { role: 'admin', updatedBy: LEADER }));
    await assertFails(deleteDoc(doc(db, 'staff', LEADER)));
  });
  it('is created by an admin and recognised straight away, whatever the email capitalisation', async () => {
    await assertSucceeds(setDoc(doc(user(ADMIN), 'staff', 'new.leader@lifecentre.sg'), { role: 'leader', name: 'New Leader', updatedBy: ADMIN }));
    const snap = await assertSucceeds(getDoc(doc(user('New.Leader@LifeCentre.sg'), 'staff', 'new.leader@lifecentre.sg')));
    assert.equal(snap.data().role, 'leader');
  });
  it('is not turned into someone who can post by an unknown role name', async () => {
    await assertFails(setDoc(doc(user(ADMIN), 'staff', 'x@lifecentre.sg'), { role: 'leaders', updatedBy: ADMIN }));
  });
});

describe('admin', () => {
  it('can add, change and remove staff', async () => {
    const db = user(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'staff', 'new@lifecentre.sg'), { role: 'leader', name: 'New Leader', updatedBy: ADMIN }));
    await assertSucceeds(setDoc(doc(db, 'staff', 'new@lifecentre.sg'), { role: 'staff', updatedBy: ADMIN }));
    await assertSucceeds(getDocs(collection(db, 'staff')));
    await assertSucceeds(deleteDoc(doc(db, 'staff', 'new@lifecentre.sg')));
  });
  it('cannot add an unknown role, a mixed-case id, or delete themselves', async () => {
    const db = user(ADMIN);
    await assertFails(setDoc(doc(db, 'staff', 'new@lifecentre.sg'), { role: 'owner', updatedBy: ADMIN }));
    await assertFails(setDoc(doc(db, 'staff', 'New@lifecentre.sg'), { role: 'staff', updatedBy: ADMIN }));
    await assertFails(deleteDoc(doc(db, 'staff', ADMIN)));
  });
});

describe('sample data', () => {
  it('every seed document passes the rules when staff writes it, and is marked as sample', async () => {
    const db = user(STAFF);
    const docs = seedDocs(STAFF);
    if (docs.length === 0) throw new Error('no seed data');
    for (const [col, id, data] of docs) {
      if (data.sample !== true) throw new Error(`${col}/${id} is not marked sample`);
      await assertSucceeds(setDoc(doc(db, col, id), data));
    }
  });
});

describe('collections without rules yet', () => {
  it('stories are denied to everyone, including admin', async () => {
    for (const db of [anon(), user(STAFF), user(ADMIN)]) {
      await assertFails(getDoc(doc(db, 'stories', 's')));
      await assertFails(setDoc(doc(db, 'stories', 's'), { title: 'x' }));
    }
  });
});

describe('videos (Watch)', () => {
  const video = (email, extra = {}) => ({ title: 'Sunday message in 60 seconds', org: 'Yishun', desc: 'A short word.', src: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', dur: 58, updatedBy: email, ...extra });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'videos', 'v1'), video(ADMIN));
    });
  });

  it('anyone can read and list videos, signed out or not', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'videos', 'v1')));
    await assertSucceeds(getDocs(collection(anon(), 'videos')));
    await assertSucceeds(getDoc(doc(user('visitor@example.com'), 'videos', 'v1')));
  });

  it('admins and leaders can post and edit, and the record must name them', async () => {
    for (const email of [ADMIN, LEADER]) {
      await assertSucceeds(setDoc(doc(user(email), 'videos', `new-${email}`), video(email)));
      await assertSucceeds(setDoc(doc(user(email), 'videos', 'v1'), video(email, { title: 'Edited' })));
    }
    await assertFails(setDoc(doc(user(ADMIN), 'videos', 'x'), video(LEADER))); // updatedBy must be the signed-in email
  });

  it('plain staff, other signed-in people, unverified emails and the public cannot post or edit', async () => {
    await assertFails(setDoc(doc(user(STAFF), 'videos', 'x'), video(STAFF)));
    await assertFails(setDoc(doc(user(STAFF), 'videos', 'v1'), video(STAFF)));
    await assertFails(setDoc(doc(user('visitor@example.com'), 'videos', 'x'), video('visitor@example.com')));
    await assertFails(setDoc(doc(user(ADMIN, false), 'videos', 'x'), video(ADMIN)));
    await assertFails(setDoc(doc(anon(), 'videos', 'x'), video(ADMIN)));
  });

  it('refuses bad videos: unknown source, link that is not https, bad length, extra fields, empty or long title', async () => {
    const db = user(ADMIN);
    for (const bad of [
      { src: 'vimeo' }, { src: 'upload', url: 'http://example.com/v.mp4' }, { videoId: 'short' }, { videoId: 'dQw4w9WgXc!' }, { videoId: 'dQw4w9WgXcQQ' }, { videoId: 12345678901 }, { url: 'javascript:alert(1)' },
      { dur: 0 }, { dur: 1.5 }, { dur: 20000 }, { title: '' }, { title: 'x'.repeat(121) }, { org: 'x'.repeat(41) }, { desc: 'x'.repeat(301) },
      { views: 10 }, { published: false },
    ]) {
      await assertFails(setDoc(doc(db, 'videos', 'x'), video(ADMIN, bad)));
    }
    const missing = video(ADMIN); delete missing.src;
    await assertFails(setDoc(doc(db, 'videos', 'x'), missing));
    const noId = video(ADMIN); delete noId.videoId; // a YouTube video must say which one
    await assertFails(setDoc(doc(db, 'videos', 'x'), noId));
    await assertSucceeds(setDoc(doc(db, 'videos', 'ok'), { title: 'Minimal', src: 'upload', updatedBy: ADMIN }));
  });

  it('admins, leaders and staff can remove a video; the public and other people cannot', async () => {
    await assertFails(deleteDoc(doc(anon(), 'videos', 'v1')));
    await assertFails(deleteDoc(doc(user('visitor@example.com'), 'videos', 'v1')));
    await assertSucceeds(deleteDoc(doc(user(STAFF), 'videos', 'v1')));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'videos', 'v1'), video(ADMIN)); });
    await assertSucceeds(deleteDoc(doc(user(LEADER), 'videos', 'v1')));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'videos', 'v1'), video(ADMIN)); });
    await assertSucceeds(deleteDoc(doc(user(ADMIN), 'videos', 'v1')));
  });
});

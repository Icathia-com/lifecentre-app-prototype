// Security rules tests. Run with: npm test (starts the Firestore emulator, needs Java 21+).
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, Timestamp, serverTimestamp, increment,
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
const verse = (email, extra = {}) => ({ passageId: 'JHN.3.16', reference: 'John 3:16', updatedBy: email, ...extra });
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
  it('can schedule a verse for a date, as a passage with a date id', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-01'), verse(STAFF)));
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-02'), verse(STAFF, { passageId: 'PSA.23.1-6', reference: 'Psalm 23:1-6', sample: true })));
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-04'), verse(STAFF, { passageId: '1JN.1.9', reference: '1 John 1:9' })));
    await assertFails(setDoc(doc(db, 'verses', 'tomorrow'), verse(STAFF)));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-03'), verse(STAFF, { passageId: '' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-03'), verse(STAFF, { passageId: 'John 3:16' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-03'), verse(STAFF, { reference: '' })));
  });
  it('limits a scheduled verse to 25 verses', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'verses', '2026-11-05'), verse(STAFF, { passageId: 'PSA.119.1-25', reference: 'Psalm 119:1-25' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-06'), verse(STAFF, { passageId: 'PSA.119.1-26', reference: 'Psalm 119:1-26' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-06'), verse(STAFF, { passageId: 'PSA.119.1-176', reference: 'Psalm 119:1-176' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-06'), verse(STAFF, { passageId: 'PSA.119.30-20', reference: 'Psalm 119:30-20' })));
  });
  it('cannot write the old text fields: the text comes from the daily job', async () => {
    const db = user(STAFF);
    await assertFails(setDoc(doc(db, 'verses', '2026-11-07'), verse(STAFF, { text: 'For God so loved the world…', translation: 'KJV' })));
    await assertFails(setDoc(doc(db, 'verses', '2026-11-07'), verse(STAFF, { translation: 'NIV' })));
  });
  it('the Bible text for a day (votd) is readable by anyone and writable by no one', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'votd', '2026-10-27'), { date: '2026-10-27', passageId: 'JHN.3.16', source: 'staff', versions: {} });
    });
    await assertSucceeds(getDoc(doc(anon(), 'votd', '2026-10-27')));
    for (const db of [anon(), user(STAFF), user(ADMIN)]) {
      await assertFails(setDoc(doc(db, 'votd', '2026-10-28'), { date: '2026-10-28', passageId: 'JHN.3.16', versions: {} }));
      await assertFails(setDoc(doc(db, 'votd', '2026-10-27'), { date: '2026-10-27', passageId: 'JHN.3.17', versions: {} }));
      await assertFails(deleteDoc(doc(db, 'votd', '2026-10-27')));
    }
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

describe('launch pop-ups', () => {
  const T0 = T('2026-11-01T00:00:00Z');
  const T1 = T('2026-11-10T00:00:00Z');
  const popup = (requestedBy, extra = {}) => ({ title: 'Christmas service', image: 'https://pub-test.r2.dev/popups/2026/11/a.jpg', start: T0, end: T1, status: 'requested', requestedBy, updatedBy: requestedBy, ...extra });
  const APPROVER = 'leader@lifecentre.sg'; // a leader with "Can approve pop-ups"
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'staff', APPROVER), { role: 'leader', approvePopups: true, updatedBy: ADMIN });
      await setDoc(doc(db, 'popups', 'r1'), popup(STAFF, { eventId: 'pub' }));
      await setDoc(doc(db, 'popups', 'l1'), popup(ADMIN, { title: 'Live one', status: 'live', approvedBy: ADMIN }));
      await setDoc(doc(db, 'popups', 'l2'), popup(ADMIN, { title: 'Live but not in the slot', status: 'live', approvedBy: ADMIN }));
      await setDoc(doc(db, 'config', 'app'), { popupsOn: true, livePopupId: 'l1', updatedBy: ADMIN });
    });
  });
  const patch = (db, id, fields) => setDoc(doc(db, 'popups', id), fields, { merge: true });

  it('everyone reads the master switch and the one pop-up in the live slot, and nothing else', async () => {
    for (const db of [anon(), user('visitor@example.com')]) {
      await assertSucceeds(getDoc(doc(db, 'config', 'app')));
      await assertSucceeds(getDoc(doc(db, 'popups', 'l1')));
      await assertFails(getDoc(doc(db, 'popups', 'l2'))); // live by status, but not the one in the slot
      await assertFails(getDoc(doc(db, 'popups', 'r1')));
      await assertFails(getDocs(collection(db, 'popups')));
      await assertFails(setDoc(doc(db, 'config', 'app'), { popupsOn: false, livePopupId: null, updatedBy: 'visitor@example.com' }));
      await assertFails(setDoc(doc(db, 'popups', 'x'), popup('visitor@example.com')));
    }
  });
  it('staff send requests in their own name, and may edit or withdraw them, but cannot make anything live', async () => {
    const db = user(STAFF);
    await assertSucceeds(setDoc(doc(db, 'popups', 'new'), popup(STAFF, { eventId: 'pub', image: `data:image/jpeg;base64,${'A'.repeat(2000)}` })));
    await assertSucceeds(setDoc(doc(db, 'popups', 'd'), popup(STAFF, { status: 'draft' })));
    await assertFails(setDoc(doc(db, 'popups', 'x'), popup(STAFF, { status: 'live' })));
    await assertFails(setDoc(doc(db, 'popups', 'x'), popup(STAFF, { status: 'approved' })));
    await assertFails(setDoc(doc(db, 'popups', 'x'), popup(ADMIN))); // in someone else's name
    await assertSucceeds(setDoc(doc(db, 'popups', 'r1'), popup(STAFF, { title: 'Christmas Eve service', end: T('2026-11-12T00:00:00Z') })));
    await assertFails(patch(db, 'r1', { status: 'live', updatedBy: STAFF }));
    await assertFails(patch(db, 'r1', { status: 'approved', approvedBy: STAFF, updatedBy: STAFF }));
    await assertFails(patch(db, 'l1', { status: 'ended', updatedBy: STAFF })); // not theirs, and not an approver
    await assertSucceeds(getDocs(collection(db, 'popups')));
    await assertSucceeds(deleteDoc(doc(db, 'popups', 'r1')));
    await assertFails(deleteDoc(doc(db, 'popups', 'l1')));
    await assertFails(setDoc(doc(db, 'config', 'app'), { popupsOn: true, livePopupId: 'r1', updatedBy: STAFF }));
  });
  it('a person with "Can approve pop-ups" approves, declines or ends, never their own request, and changes nothing else', async () => {
    const db = user(APPROVER);
    await assertSucceeds(getDocs(collection(db, 'popups')));
    await assertSucceeds(patch(db, 'r1', { status: 'live', approvedBy: APPROVER, updatedBy: APPROVER }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'popups', 'r1'), popup(STAFF)));
    await assertSucceeds(patch(db, 'r1', { status: 'declined', approvedBy: APPROVER, note: 'Another pop-up is live until Tuesday.', updatedBy: APPROVER }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'popups', 'r1'), popup(STAFF)));
    await assertFails(patch(db, 'r1', { status: 'live', approvedBy: ADMIN, updatedBy: APPROVER })); // must sign the decision themselves
    await assertFails(patch(db, 'r1', { status: 'live', approvedBy: APPROVER, title: 'Renamed', updatedBy: APPROVER })); // only the decision changes
    await assertFails(setDoc(doc(db, 'popups', 'r1'), popup(STAFF, { status: 'live', approvedBy: APPROVER, updatedBy: APPROVER, start: T1, end: T('2026-11-20T00:00:00Z') })));
    await assertSucceeds(patch(db, 'l1', { status: 'ended', updatedBy: APPROVER })); // the one that was live, when replacing it
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'popups', 'own'), popup(APPROVER)));
    await assertFails(patch(db, 'own', { status: 'live', approvedBy: APPROVER, updatedBy: APPROVER }));
    await assertFails(patch(db, 'own', { status: 'approved', approvedBy: APPROVER, updatedBy: APPROVER }));
    await assertSucceeds(setDoc(doc(db, 'config', 'app'), { popupsOn: true, livePopupId: 'r1', updatedBy: APPROVER }));
    await assertFails(setDoc(doc(db, 'config', 'app'), { popupsOn: false, livePopupId: 'r1', updatedBy: APPROVER })); // the switch is for admins
    await assertFails(setDoc(doc(db, 'popups', 'x'), popup(APPROVER))); // a leader does not post
    await assertFails(deleteDoc(doc(db, 'popups', 'r1')));
  });
  it('an approver may create the config document, but only with the switch off', async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'config', 'app')));
    await assertFails(setDoc(doc(user(APPROVER), 'config', 'app'), { popupsOn: true, livePopupId: 'r1', updatedBy: APPROVER }));
    await assertSucceeds(setDoc(doc(user(APPROVER), 'config', 'app'), { popupsOn: false, livePopupId: 'r1', updatedBy: APPROVER }));
  });
  it('admins run the switch, make pop-ups live directly, delete any, but still cannot approve their own request', async () => {
    const db = user(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'config', 'app'), { popupsOn: false, livePopupId: null, updatedBy: ADMIN }));
    await assertSucceeds(setDoc(doc(db, 'popups', 'direct'), popup(ADMIN, { status: 'live', approvedBy: ADMIN })));
    await assertSucceeds(setDoc(doc(db, 'popups', 'later'), popup(ADMIN, { status: 'approved', approvedBy: ADMIN })));
    await assertSucceeds(patch(db, 'r1', { status: 'live', approvedBy: ADMIN, updatedBy: ADMIN }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'popups', 'mine'), popup(ADMIN)));
    await assertFails(patch(db, 'mine', { status: 'live', approvedBy: ADMIN, updatedBy: ADMIN }));
    await assertSucceeds(patch(db, 'mine', { status: 'draft', updatedBy: ADMIN })); // but may keep it as a draft
    await assertSucceeds(deleteDoc(doc(db, 'popups', 'l1')));
    await assertFails(deleteDoc(doc(db, 'config', 'app')));
  });
  it('refuses a bad pop-up: a picture that is not https or a JPEG, an end before the start, an unknown status, extra fields', async () => {
    const db = user(ADMIN);
    for (const bad of [
      { image: 'http://example.org/a.jpg' }, { image: 'javascript:alert(1)' }, { image: `data:image/png;base64,${'A'.repeat(100)}` }, { image: `data:image/jpeg;base64,${'A'.repeat(140000)}` },
      { end: T('2026-10-31T00:00:00Z') }, { end: T0 }, { status: 'pending' }, { title: '' }, { title: 'x'.repeat(81) }, { note: 'x'.repeat(301) }, { eventId: 'x'.repeat(101) }, { views: 1 },
    ]) await assertFails(setDoc(doc(db, 'popups', 'bad'), popup(ADMIN, bad)));
    const { start, ...noStart } = popup(ADMIN);
    await assertFails(setDoc(doc(db, 'popups', 'bad'), noStart));
  });
  it('"Can approve pop-ups" is a switch only admins set on a staff entry', async () => {
    await assertSucceeds(setDoc(doc(user(ADMIN), 'staff', STAFF), { role: 'staff', approvePopups: true, updatedBy: ADMIN }));
    await assertSucceeds(setDoc(doc(user(ADMIN), 'staff', STAFF), { role: 'staff', approvePopups: false, updatedBy: ADMIN }));
    await assertFails(setDoc(doc(user(ADMIN), 'staff', STAFF), { role: 'staff', approvePopups: 'yes', updatedBy: ADMIN }));
    await assertFails(setDoc(doc(user(STAFF), 'staff', STAFF), { role: 'staff', approvePopups: true, updatedBy: STAFF }));
  });
});

describe('stories', () => {
  const POSTER = 'leader@lifecentre.sg'; // a leader with "Can post stories"
  const HOUR = 3600000;
  const story = (email, extra = {}) => Object.fromEntries(Object.entries({ // a field set to undefined is left out
    author: email, authorName: 'Sam', type: 'video', mediaUrl: 'https://pub-test.r2.dev/stories/2026/11/a.webm', mediaType: 'video/webm', colours: ['#1B1740', '#3558C8'],
    duration: 75, parts: [{ start: 0, end: 30 }, { start: 30, end: 60 }, { start: 60, end: 75 }], views: 0, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * HOUR), updatedBy: email, ...extra,
  }).filter(([, v]) => v !== undefined));
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'staff', POSTER), { role: 'leader', postStories: true, updatedBy: ADMIN });
      await setDoc(doc(db, 'stories', 's1'), { ...story(ADMIN), createdAt: T('2026-11-03T00:00:00Z'), views: 4 });
    });
  });
  const parts = (n, len = 30) => Array.from({ length: n }, (_, k) => ({ start: k * len, end: (k + 1) * len }));

  it('everyone reads and lists stories, signed in or not', async () => {
    for (const db of [anon(), user('visitor@example.com'), user(STAFF)]) {
      await assertSucceeds(getDoc(doc(db, 'stories', 's1')));
      await assertSucceeds(getDocs(collection(db, 'stories')));
    }
  });
  it('admins and people with "Can post stories" post in their own name; plain staff, leaders without it and the public cannot', async () => {
    await assertSucceeds(setDoc(doc(user(ADMIN), 'stories', 'a'), story(ADMIN)));
    await assertSucceeds(setDoc(doc(user(POSTER), 'stories', 'p'), story(POSTER, { type: 'text', mediaUrl: undefined, mediaType: undefined, text: 'Hello', duration: 6, parts: parts(1, 6) })));
    await assertFails(setDoc(doc(user(POSTER), 'stories', 'x'), story(ADMIN))); // not in someone else's name
    await assertFails(setDoc(doc(user(STAFF), 'stories', 'x'), story(STAFF)));
    await assertFails(setDoc(doc(anon(), 'stories', 'x'), story(ADMIN)));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'staff', POSTER), { role: 'leader', postStories: false, updatedBy: ADMIN }));
    await assertFails(setDoc(doc(user(POSTER), 'stories', 'y'), story(POSTER)));
  });
  it('keeps a story to the limits: parts of a recording, length by type, text length, https media, colours, zero views, 24 hours', async () => {
    const db = user(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'stories', 'v6'), story(ADMIN, { duration: 180, parts: parts(6) })));
    await assertSucceeds(setDoc(doc(db, 'stories', 'a10'), story(ADMIN, { type: 'audio', mediaUrl: 'https://pub-test.r2.dev/stories/a.weba', mediaType: 'audio/webm', duration: 300, parts: parts(10), bgImage: 'https://pub-test.r2.dev/stories/bg.jpg' })));
    await assertSucceeds(setDoc(doc(db, 'stories', 'ph'), story(ADMIN, { type: 'photo', mediaUrl: 'https://pub-test.r2.dev/stories/p.jpg', mediaType: 'image/jpeg', duration: 5, parts: parts(1, 5), text: 'Over the picture', authorPhoto: 'https://pub-test.r2.dev/avatars/me.jpg' })));
    for (const bad of [
      { parts: parts(7), duration: 180 }, { duration: 181, parts: parts(6) }, { type: 'audio', parts: parts(11), duration: 300 }, { type: 'audio', duration: 301, parts: parts(10) },
      { type: 'photo', duration: 16, parts: parts(1, 16) }, { type: 'photo', parts: parts(2, 5), duration: 10 }, { parts: [] }, { duration: 0 }, { duration: 2.5 },
      { type: 'text', mediaUrl: undefined, text: '' }, { type: 'text', text: 'has media too' }, { type: 'text', mediaUrl: undefined, text: 'x'.repeat(301) }, { text: 'x'.repeat(301) },
      { mediaUrl: 'http://example.org/a.webm' }, { mediaUrl: undefined }, { mediaUrl: 'javascript:alert(1)' }, { colours: ['blue', '#000000'] }, { colours: ['#000000'] }, { colours: 'red' },
      { views: 1 }, { views: -1 }, { type: 'gif' }, { authorName: '' }, { bgImage: 'http://x.y/z.jpg' }, { likes: 3 },
      { expiresAt: Timestamp.fromMillis(Date.now() + 30 * HOUR) }, { expiresAt: Timestamp.fromMillis(Date.now() + 20 * HOUR) }, { createdAt: T('2026-11-01T00:00:00Z') },
    ]) await assertFails(setDoc(doc(db, 'stories', 'bad'), story(ADMIN, bad)));
  });
  it('anyone may count one more view and change nothing else; the author or an admin deletes', async () => {
    for (const db of [anon(), user('visitor@example.com'), user(STAFF)]) {
      const before = (await getDoc(doc(env.unauthenticatedContext().firestore(), 'stories', 's1'))).data().views;
      await assertSucceeds(updateDoc(doc(db, 'stories', 's1'), { views: increment(1) }));
      await assertSucceeds(updateDoc(doc(db, 'stories', 's1'), { views: before + 2 }));
      await assertFails(updateDoc(doc(db, 'stories', 's1'), { views: increment(2) }));
      await assertFails(updateDoc(doc(db, 'stories', 's1'), { views: before + 2 })); // not by 1
      await assertFails(updateDoc(doc(db, 'stories', 's1'), { views: increment(1), text: 'changed' }));
      await assertFails(updateDoc(doc(db, 'stories', 's1'), { text: 'changed' }));
      await assertFails(deleteDoc(doc(db, 'stories', 's1')));
    }
    await assertFails(deleteDoc(doc(user(POSTER), 'stories', 's1'))); // someone else's
    await assertSucceeds(deleteDoc(doc(user(ADMIN), 'stories', 's1')));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'stories', 'p1'), story(POSTER)));
    await assertSucceeds(deleteDoc(doc(user(POSTER), 'stories', 'p1')));
  });
  it('a staff member changes only their own display name and photo; admins set "Can post stories"', async () => {
    const db = user(STAFF);
    await assertSucceeds(updateDoc(doc(db, 'staff', STAFF), { displayName: 'Pastor Sam', photo: 'https://pub-test.r2.dev/avatars/sam.jpg', updatedBy: STAFF, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, 'staff', STAFF), { displayName: '', photo: '', updatedBy: STAFF }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { displayName: 'Sam', role: 'admin', updatedBy: STAFF }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { displayName: 'Sam', postStories: true, updatedBy: STAFF }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { photo: 'http://example.org/me.jpg', updatedBy: STAFF }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { displayName: 'x'.repeat(61), updatedBy: STAFF }));
    await assertFails(updateDoc(doc(db, 'staff', ADMIN), { displayName: 'Not me', updatedBy: STAFF }));
    await assertFails(updateDoc(doc(user('visitor@example.com'), 'staff', 'visitor@example.com'), { displayName: 'Me', updatedBy: 'visitor@example.com' })); // no entry to change
    await assertSucceeds(setDoc(doc(user(ADMIN), 'staff', STAFF), { role: 'staff', postStories: true, displayName: 'Pastor Sam', updatedBy: ADMIN }));
    await assertFails(setDoc(doc(user(ADMIN), 'staff', STAFF), { role: 'staff', postStories: 'yes', updatedBy: ADMIN }));
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

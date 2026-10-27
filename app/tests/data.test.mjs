// The data layer against the Firestore emulator, using the real security rules.
// Run with: npm test (starts the emulators).
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { createData } from '../js/data.js';
import { seedDocs } from '../../firebase/seed/seed.mjs';
import { dateKey, addDays, dayStart } from '../js/util.js';

const NOW = Date.parse('2026-10-27T02:00:00Z'); // 10:00 on 27 Oct in Singapore
const TODAY = dateKey(NOW);
const T = (iso) => Timestamp.fromDate(new Date(iso));
const STAFF = 'staff@lifecentre.sg';

// A stand-in for the phone's saved storage.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'lifecentre-app', firestore: { rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  store.clear();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', STAFF), { role: 'staff', updatedBy: STAFF });
    for (const [col, id, data] of seedDocs('sample-data')) await setDoc(doc(db, col, id), data);
    await setDoc(doc(db, 'announcements', 'draft'), { title: 'Draft', body: '', pinned: false, published: false, publishedAt: T('2026-10-27T00:00:00Z'), updatedBy: STAFF });
    await setDoc(doc(db, 'announcements', 'expired'), { title: 'Expired', body: '', pinned: false, published: true, publishedAt: T('2026-10-01T00:00:00Z'), expiresAt: T('2026-10-20T00:00:00Z'), updatedBy: STAFF });
    await setDoc(doc(db, 'events', 'draft'), { title: 'Draft event', start: T('2026-10-31T11:30:00Z'), published: false, updatedBy: STAFF });
    await setDoc(doc(db, 'events', 'far'), { title: 'Far away', start: T('2027-03-01T11:30:00Z'), published: true, updatedBy: STAFF });
  });
});

const publicData = () => createData(env.unauthenticatedContext().firestore(), { now: () => NOW });
const staffData = () => createData(env.authenticatedContext('s', { email: STAFF, email_verified: true }).firestore(), { now: () => NOW });
const brokenData = () => createData(null, { now: () => NOW }); // every read fails, like being offline

describe('reading as the public', () => {
  it('gets the verse scheduled for today', async () => {
    const { value, source } = await publicData().getVerse(TODAY);
    assert.equal(source, 'live');
    assert.equal(value.reference, 'Psalm 46:10');
    assert.equal(value.translation, 'KJV');
    assert.equal(value.sample, true);
  });
  it('gets a backup verse when none is scheduled', async () => {
    const { value, source } = await publicData().getVerse('2030-01-01');
    assert.equal(source, 'live');
    assert.ok(value.reference && value.text);
    assert.equal(value.sample, undefined);
  });
  it('gets published announcements, pinned first, without drafts or expired ones', async () => {
    const { value, source } = await publicData().getAnnouncements();
    assert.equal(source, 'live');
    assert.deepEqual(value.map((a) => a.id), ['sample-conference', 'sample-cell-groups', 'sample-volunteers']);
    assert.equal(value[0].pinned, true);
    assert.equal(typeof value[0].publishedAt, 'number');
  });
  it('gets published events in the range, soonest first', async () => {
    const { value, source } = await publicData().getEvents({ from: dayStart(TODAY), to: dayStart(addDays(TODAY, 14)) });
    assert.equal(source, 'live');
    assert.deepEqual(value.map((e) => e.id), ['sample-cell-group', 'sample-prayer', 'sample-lunch']);
    assert.ok(value.every((e) => typeof e.start === 'number' && e.start < e.end));
  });
  it('leaves out events outside the range', async () => {
    const { value } = await publicData().getEvents({ from: dayStart(TODAY), to: dayStart(addDays(TODAY, 5)) });
    assert.deepEqual(value.map((e) => e.id), ['sample-cell-group']);
  });
});

describe('when the database cannot be reached', () => {
  it('shows what was saved on the phone after an earlier visit', async () => {
    const online = publicData();
    const range = { from: dayStart(TODAY), to: dayStart(addDays(TODAY, 14)) };
    const live = { verse: await online.getVerse(TODAY), announcements: await online.getAnnouncements(), events: await online.getEvents(range) };

    const offline = brokenData();
    const cached = { verse: await offline.getVerse(TODAY), announcements: await offline.getAnnouncements(), events: await offline.getEvents(range) };
    for (const key of Object.keys(live)) {
      assert.equal(cached[key].source, 'cache', key);
      assert.deepEqual(cached[key].value, live[key].value, key);
    }
  });
  it('shows saved events later, even on a different day than they were saved', async () => {
    await publicData().getEvents({ from: dayStart(TODAY), to: dayStart(addDays(TODAY, 14)) });
    const tomorrow = addDays(TODAY, 1);
    const { value, source } = await brokenData().getEvents({ from: dayStart(tomorrow), to: dayStart(addDays(tomorrow, 14)) });
    assert.equal(source, 'cache');
    assert.equal(value.length, 3);
  });
  it('falls back to labelled sample content when nothing is saved', async () => {
    const offline = brokenData();
    const announcements = await offline.getAnnouncements();
    assert.equal(announcements.source, 'fallback');
    assert.ok(announcements.value.length > 0 && announcements.value.every((a) => a.sample === true));
    const events = await offline.getEvents({ from: dayStart(TODAY), to: dayStart(addDays(TODAY, 14)) });
    assert.equal(events.source, 'fallback');
    assert.ok(events.value.length > 0 && events.value.every((e) => e.sample === true));
    const verse = await offline.getVerse(TODAY);
    assert.equal(verse.source, 'fallback');
    assert.ok(verse.value.reference && verse.value.text);
  });
});

describe('staff writes', () => {
  it('saves an announcement, lists drafts, and deletes it', async () => {
    const data = staffData();
    const id = await data.admin.save('announcements', STAFF, { title: 'Hello', body: 'World', pinned: false, published: false, publishedAt: NOW, linkUrl: 'https://example.org', linkLabel: 'Open' });
    const all = await data.admin.list('announcements');
    const saved = all.find((a) => a.id === id);
    assert.deepEqual([saved.title, saved.published, saved.linkUrl], ['Hello', false, 'https://example.org']);
    assert.ok(all.some((a) => a.id === 'draft'));
    assert.equal((await publicData().getAnnouncements()).value.some((a) => a.id === id), false); // a draft is not public
    await data.admin.remove('announcements', id);
    assert.equal((await data.admin.list('announcements')).some((a) => a.id === id), false);
  });
  it('removes the sample label when a sample item is edited', async () => {
    const data = staffData();
    await data.admin.save('announcements', STAFF, { title: 'Real one', body: '', pinned: true, published: true, publishedAt: NOW }, 'sample-conference');
    const { value } = await publicData().getAnnouncements();
    assert.equal(value.find((a) => a.id === 'sample-conference').sample, undefined);
  });
  it('schedules a verse by date and an event with optional fields left out', async () => {
    const data = staffData();
    await data.admin.save('verses', STAFF, { date: '2026-12-25', reference: 'Luke 2:11', text: 'For unto you is born this day in the city of David a Saviour, which is Christ the Lord.', translation: 'KJV' }, '2026-12-25');
    assert.equal((await publicData().getVerse('2026-12-25')).value.reference, 'Luke 2:11');
    const id = await data.admin.save('events', STAFF, { title: 'Carols', start: dayStart('2026-12-24') + 19 * 3600000, published: true });
    assert.equal((await data.admin.list('events')).find((e) => e.id === id).end, undefined);
  });
  it('reads the signed-in account\'s staff entry', async () => {
    assert.equal((await staffData().admin.getStaffEntry(STAFF)).role, 'staff');
    assert.equal(await staffData().admin.getStaffEntry('Staff@LifeCentre.SG').then((e) => e.id), STAFF);
  });
  it('is refused for the public, and the database is left unchanged', async () => {
    await assert.rejects(() => publicData().admin.save('announcements', STAFF, { title: 'Nope', body: '', pinned: false, published: true, publishedAt: NOW }, 'nope'), { code: 'permission-denied' });
    let exists;
    await env.withSecurityRulesDisabled(async (ctx) => { exists = (await getDoc(doc(ctx.firestore(), 'announcements', 'nope'))).exists(); });
    assert.equal(exists, false);
  });
  it('is refused for staff managing the staff list', async () => {
    await assert.rejects(() => staffData().admin.save('staff', STAFF, { role: 'admin' }, 'x@lifecentre.sg'), { code: 'permission-denied' });
  });
});

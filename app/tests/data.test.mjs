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
const at = (days, hour, minute = 0) => Timestamp.fromMillis(dayStart(addDays(TODAY, days)) + (hour * 60 + minute) * 60000);
const STAFF = 'staff@lifecentre.sg';
const LEADER = 'leader@lifecentre.sg';

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
    await setDoc(doc(db, 'staff', LEADER), { role: 'leader', updatedBy: STAFF });
    for (const [col, id, data] of seedDocs('sample-data')) await setDoc(doc(db, col, id), data);
    await setDoc(doc(db, 'announcements', 'draft'), { title: 'Draft', body: '', pinned: false, published: false, publishedAt: T('2026-10-27T00:00:00Z'), updatedBy: STAFF });
    await setDoc(doc(db, 'announcements', 'expired'), { title: 'Expired', body: '', pinned: false, published: true, publishedAt: T('2026-10-01T00:00:00Z'), expiresAt: T('2026-10-20T00:00:00Z'), updatedBy: STAFF });
    const ev = { location: 'yishun', type: 'cell', published: true, updatedBy: STAFF };
    await setDoc(doc(db, 'events', 'e-cell'), { ...ev, title: 'Cell group night', start: at(3, 19, 30), end: at(3, 21), host: 'Discipleship Team', cover: { from: '#14532D', to: '#4ADE80', label: 'CELL\nGROUP' } });
    await setDoc(doc(db, 'events', 'e-prayer'), { ...ev, type: 'prayer', title: 'Prayer evening', start: at(8, 19, 30), end: at(8, 21) });
    await setDoc(doc(db, 'events', 'e-lunch'), { ...ev, type: 'special', location: 'other', place: 'Park', title: 'Community lunch', start: at(12, 12, 30), end: at(12, 14) });
    await setDoc(doc(db, 'events', 'draft'), { ...ev, title: 'Draft event', start: at(2, 10), published: false, pinned: true });
    await setDoc(doc(db, 'events', 'far'), { ...ev, title: 'Far away', start: T('2027-09-01T11:30:00Z') });
  });
});

const publicData = () => createData(env.unauthenticatedContext().firestore(), { now: () => NOW });
const staffData = () => createData(env.authenticatedContext('s', { email: STAFF, email_verified: true }).firestore(), { now: () => NOW });
const brokenData = () => createData(null, { now: () => NOW }); // every read fails, like being offline

describe('reading as the public', () => {
  it('gets the verse scheduled for today', async () => {
    const { value, source } = await publicData().getVerse(TODAY);
    assert.equal(source, 'live');
    assert.equal(value.reference, 'Psalm 46:10'); // a scheduled passage: the built-in KJV text for it
    assert.equal(value.translation, 'KJV');
    assert.match(value.text, /^Be still, and know that I am God/);
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
    assert.deepEqual(value.map((e) => e.id), ['e-cell', 'e-prayer', 'e-lunch']);
    assert.ok(value.every((e) => typeof e.start === 'number' && e.start < e.end && e.location && e.type));
    assert.deepEqual(value[0].cover, { from: '#14532D', to: '#4ADE80', label: 'CELL\nGROUP' });
    assert.equal(value[2].place, 'Park');
  });
  it('leaves out events outside the range', async () => {
    const { value } = await publicData().getEvents({ from: dayStart(TODAY), to: dayStart(addDays(TODAY, 5)) });
    assert.deepEqual(value.map((e) => e.id), ['e-cell']);
  });
  it('gets one event by id, and nothing for a draft or an unknown id', async () => {
    const { value, source } = await publicData().getEvent('e-prayer');
    assert.equal(source, 'live');
    assert.deepEqual([value.id, value.type, value.location, value.published], ['e-prayer', 'prayer', 'yishun', true]);
    assert.equal((await publicData().getEvent('draft')).value, null); // a draft is not public
    assert.equal((await publicData().getEvent('nope')).value, null);
  });
  it('gets the pinned event: published and not finished', async () => {
    const { value, source } = await publicData().getPinnedEvent();
    assert.equal(source, 'live');
    assert.equal(value.id, 'conf'); // the draft that is also pinned is not public
    assert.equal(value.pinned, true);
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
  it('schedules a verse by date', async () => {
    const data = staffData();
    await data.admin.save('verses', STAFF, { date: '2026-12-25', passageId: 'LUK.2.11', reference: 'Luke 2:11' }, '2026-12-25');
    const saved = (await data.admin.list('verses')).find((v) => v.id === '2026-12-25');
    assert.deepEqual([saved.passageId, saved.reference, saved.text, saved.translation], ['LUK.2.11', 'Luke 2:11', undefined, undefined]);
    assert.ok((await publicData().getVerse('2026-12-25')).value.text, 'the built-in verse stands in until the daily job has the text');
  });
  it('creates an event with only the required fields, and leaves the optional ones out', async () => {
    const data = staffData();
    const id = await data.admin.save('events', STAFF, { title: 'Carols', start: dayStart('2026-12-24') + 19 * 3600000, location: 'yishun', type: 'special', published: true });
    const saved = (await data.admin.list('events')).find((e) => e.id === id);
    assert.deepEqual([saved.end, saved.price, saved.cover, saved.pinned, saved.registerUrl], [undefined, undefined, undefined, undefined, undefined]);
    assert.equal(typeof saved.createdAt, 'number'); // the server time, set on creation
  });
  it('saves every create-event option and reads it back', async () => {
    const data = staffData();
    const values = {
      title: 'Youth night', start: at(5, 19).toMillis(), end: at(5, 21).toMillis(), location: 'other', place: 'Pasir Ris Park', type: 'youth', host: 'Teens & Youth',
      description: 'Games and worship', cover: { from: '#FF6A3D', to: '#E5326B', label: 'YOUTH\nNIGHT' }, registerUrl: 'https://example.org/youth', requireApproval: true,
      price: 10, capacity: 50, notifyFollowers: true, pinned: true, published: true,
    };
    const id = await data.admin.save('events', STAFF, values);
    const { value } = await publicData().getEvent(id);
    for (const [key, expected] of Object.entries(values)) assert.deepEqual(value[key], expected, key);
  });
  it('keeps the creation time when an event is edited, and drops the sample label', async () => {
    const data = staffData();
    const id = await data.admin.save('events', STAFF, { title: 'First', start: at(5, 19).toMillis(), location: 'tuas', type: 'service', published: true });
    const first = (await publicData().getEvent(id)).value;
    await data.admin.save('events', STAFF, { title: 'Second', start: at(5, 19).toMillis(), location: 'tuas', type: 'service', published: true, createdAt: first.createdAt }, id);
    const second = (await publicData().getEvent(id)).value;
    assert.deepEqual([second.title, second.createdAt], ['Second', first.createdAt]);
    await data.admin.save('events', STAFF, { title: 'Real conference', start: at(80, 9).toMillis(), location: 'yishun', type: 'special', pinned: true, published: true }, 'conf');
    assert.equal((await publicData().getPinnedEvent()).value.sample, undefined);
  });
  it('is refused an event with a location or type outside the design lists', async () => {
    await assert.rejects(() => staffData().admin.save('events', STAFF, { title: 'Bad', start: at(5, 19).toMillis(), location: 'Main hall', type: 'special', published: true }), { code: 'permission-denied' });
    await assert.rejects(() => staffData().admin.save('events', STAFF, { title: 'Bad', start: at(5, 19).toMillis(), location: 'yishun', type: 'party', published: true }), { code: 'permission-denied' });
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

describe('a leader', () => {
  const leaderData = () => createData(env.authenticatedContext('l', { email: LEADER, email_verified: true }).firestore(), { now: () => NOW });
  it('is recognised by the app through their staff entry', async () => {
    const entry = await leaderData().admin.getStaffEntry(LEADER);
    assert.equal(entry.role, 'leader');
  });
  it('cannot post notices or events, and cannot list drafts', async () => {
    const data = leaderData();
    await assert.rejects(() => data.admin.save('announcements', LEADER, { title: 'Nope', body: '', pinned: false, published: true, publishedAt: NOW }), { code: 'permission-denied' });
    await assert.rejects(() => data.admin.save('events', LEADER, { title: 'Nope', start: at(5, 19).toMillis(), location: 'yishun', type: 'special', published: true }), { code: 'permission-denied' });
    await assert.rejects(() => data.admin.list('announcements'), { code: 'permission-denied' });
    await assert.rejects(() => data.admin.list('events'), { code: 'permission-denied' });
  });
});

describe('Watch videos', () => {
  const publicData = () => createData(env.unauthenticatedContext().firestore(), { now: () => NOW });
  const asData = (email) => createData(env.authenticatedContext(email, { email, email_verified: true }).firestore(), { now: () => NOW });
  const YT = { title: 'Sunday message', src: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };

  it('gives an empty list when nothing is posted, so Watch can show its sample cards', async () => {
    const { value, source } = await publicData().getVideos();
    assert.deepEqual(value, []);
    assert.equal(source, 'live');
  });
  it('lets a leader post a video, and the public reads them newest first', async () => {
    const leader = asData(LEADER);
    const first = await leader.admin.save('videos', LEADER, { ...YT, title: 'First', org: 'Kids' });
    await new Promise((r) => setTimeout(r, 30));
    await leader.admin.save('videos', LEADER, { ...YT, title: 'Second', videoId: 'abcdefghijk' });
    const { value } = await publicData().getVideos();
    assert.deepEqual(value.map((v) => v.title), ['Second', 'First']);
    assert.equal(value[1].id, first);
    assert.equal(value[1].org, 'Kids');
    assert.equal(value[1].videoId, 'dQw4w9WgXcQ');
    assert.equal(typeof value[1].createdAt, 'number');
  });
  it('refuses a video from plain staff or the public, and a YouTube video without a valid id', async () => {
    await assert.rejects(() => asData(STAFF).admin.save('videos', STAFF, YT), { code: 'permission-denied' });
    await assert.rejects(() => publicData().admin.save('videos', STAFF, YT), { code: 'permission-denied' });
    await assert.rejects(() => asData(LEADER).admin.save('videos', LEADER, { ...YT, videoId: 'nope' }), { code: 'permission-denied' });
  });
  it('lets staff remove a video', async () => {
    const id = await asData(LEADER).admin.save('videos', LEADER, YT);
    await asData(STAFF).admin.remove('videos', id);
    assert.deepEqual((await publicData().getVideos()).value, []);
  });
});

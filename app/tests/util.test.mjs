// Pure logic: no emulator or browser needed.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey, addDays, dayStart, sgInputToMs, msToSgInput, formatTime, formatTimeRange, safeUrl,
  googleCalendarUrl, icsText,
} from '../js/util.js';
import { BACKUP_VERSES, backupVerse, sampleAnnouncements, sampleEvents } from '../js/sample-data.js';

describe('Singapore dates', () => {
  it('uses the Singapore day, whatever the device time zone', () => {
    assert.equal(dateKey(Date.parse('2026-10-27T16:30:00Z')), '2026-10-28'); // 00:30 in Singapore
    assert.equal(dateKey(Date.parse('2026-10-27T15:59:00Z')), '2026-10-27');
  });
  it('adds days across month and year ends', () => {
    assert.equal(addDays('2026-10-30', 3), '2026-11-02');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
  it('finds the start of a Singapore day', () => assert.equal(new Date(dayStart('2026-10-28')).toISOString(), '2026-10-27T16:00:00.000Z'));
  it('reads and writes datetime-local values as Singapore time', () => {
    assert.equal(new Date(sgInputToMs('2026-10-30T19:30')).toISOString(), '2026-10-30T11:30:00.000Z');
    assert.equal(msToSgInput(Date.parse('2026-10-30T11:30:00Z')), '2026-10-30T19:30');
    assert.equal(msToSgInput(Date.parse('2026-10-30T16:00:00Z')), '2026-10-31T00:00'); // midnight, not 24:00
  });
  it('formats times', () => {
    assert.equal(formatTime(Date.parse('2026-10-30T11:30:00Z')), '7:30pm');
    assert.equal(formatTimeRange(Date.parse('2026-10-30T11:30:00Z'), Date.parse('2026-10-30T13:00:00Z')), '7:30pm – 9:00pm');
  });
});

describe('links', () => {
  it('only allows https links', () => {
    assert.equal(safeUrl('https://example.org/x'), 'https://example.org/x');
    for (const bad of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x', '', null, undefined, 'https://a b']) assert.equal(safeUrl(bad), null);
  });
  it('builds a Google Calendar link', () => {
    const url = new URL(googleCalendarUrl({ id: 'e', title: 'Cell group, night', start: Date.parse('2026-10-30T11:30:00Z'), end: Date.parse('2026-10-30T13:00:00Z'), location: 'Main hall' }));
    assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
    assert.equal(url.searchParams.get('text'), 'Cell group, night');
    assert.equal(url.searchParams.get('dates'), '20261030T113000Z/20261030T130000Z');
    assert.equal(url.searchParams.get('location'), 'Main hall');
  });
  it('builds an .ics file, escaping special characters and defaulting to one hour', () => {
    const ics = icsText({ id: 'e1', title: 'Prayer; worship, evening', start: Date.parse('2026-11-04T11:30:00Z'), description: 'Line one\nLine two' }, Date.parse('2026-10-27T00:00:00Z'));
    assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(ics, /UID:e1@lifecentre\.sg/);
    assert.match(ics, /DTSTART:20261104T113000Z\r\nDTEND:20261104T123000Z/);
    assert.match(ics, /SUMMARY:Prayer\\; worship\\, evening/);
    assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
    assert.match(ics, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
  });
});

describe('backup verses and sample content', () => {
  it('gives everyone the same backup verse on a given day, and changes it day to day', () => {
    assert.deepEqual(backupVerse('2026-10-27'), backupVerse('2026-10-27'));
    assert.notEqual(backupVerse('2026-10-27').reference, backupVerse('2026-10-28').reference);
    assert.equal(backupVerse('2026-10-27').translation, 'KJV');
  });
  it('has only unique, complete backup verses', () => {
    assert.equal(new Set(BACKUP_VERSES.map((v) => v.reference)).size, BACKUP_VERSES.length);
    for (const v of BACKUP_VERSES) assert.ok(v.reference && v.text);
  });
  it('marks every sample announcement and event as sample, and puts events in the future', () => {
    const now = Date.parse('2026-10-27T03:00:00Z');
    for (const a of sampleAnnouncements(now)) assert.equal(a.sample, true);
    for (const e of sampleEvents(now)) { assert.equal(e.sample, true); assert.ok(e.start > now); assert.ok(e.end > e.start); }
  });
  it('matches the ids and titles in firebase/seed/seed.json', () => {
    const seed = JSON.parse(readFileSync(new URL('../../firebase/seed/seed.json', import.meta.url), 'utf8'));
    assert.deepEqual(sampleAnnouncements().map((a) => [a.id, a.title, a.body]).sort(), Object.entries(seed.announcements).map(([id, a]) => [id, a.title, a.body]).sort());
    assert.deepEqual(sampleEvents().map((e) => [e.id, e.title]).sort(), Object.entries(seed.events).map(([id, e]) => [id, e.title]).sort());
  });
});

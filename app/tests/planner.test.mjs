import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { itemsFor, occursOn, progress, makeTask } from '../js/planner.js';
import { dayStart } from '../js/util.js';

const NOW = dayStart('2026-10-28') + 12 * 3600000; // 28 Oct 2026, noon in Singapore
const ev = (id, key, hour, extra = {}) => ({ id, title: id, start: dayStart(key) + hour * 3600000, ...extra });
const states = (items) => Object.fromEntries(items.map((i) => [i.id, i.state]));

describe('which days a task is on', () => {
  const t = (repeat, date = '2026-10-28') => ({ id: 'a', title: 'x', date, min: 540, repeat, done: {} });
  it('is one day when it does not repeat', () => {
    assert.equal(occursOn(t('none'), '2026-10-28'), true);
    assert.equal(occursOn(t('none'), '2026-10-29'), false);
  });
  it('is every day from its first day when it repeats daily', () => {
    assert.equal(occursOn(t('daily'), '2026-10-27'), false);
    assert.equal(occursOn(t('daily'), '2026-10-28'), true);
    assert.equal(occursOn(t('daily'), '2027-03-01'), true);
  });
  it('is the same weekday from its first day when it repeats weekly', () => {
    assert.equal(occursOn(t('weekly'), '2026-11-04'), true);
    assert.equal(occursOn(t('weekly'), '2026-11-05'), false);
    assert.equal(occursOn(t('weekly'), '2026-10-21'), false);
  });
  it('makes a task from the sheet, keeping what was already ticked', () => {
    const made = makeTask({ id: 'a', title: '  Walk ', date: '2026-10-28', time: '06:30', repeat: 'weekly', notes: ' x ' }, { done: { '2026-10-28': true } });
    assert.deepEqual(made, { id: 'a', title: 'Walk', date: '2026-10-28', min: 390, repeat: 'weekly', notes: 'x', done: { '2026-10-28': true } });
    assert.equal(makeTask({ title: 'a', date: '2026-10-28', time: '09:00', repeat: 'bogus', notes: '' }).repeat, 'none');
  });
});

describe('the day\'s items', () => {
  it('always has the daily verse, devotion and prayer, in order', () => {
    assert.deepEqual(itemsFor('2026-12-01', { now: NOW }).map((i) => [i.id, i.min]), [['daily:verse', 420], ['daily:dev', 435], ['daily:prayer', 450]]);
  });
  it('marks the first thing still to do "next" today, and the rest "later"', () => {
    const items = itemsFor('2026-10-28', { now: NOW, events: [ev('lunch', '2026-10-28', 12), ev('night', '2026-10-28', 19)] });
    assert.deepEqual(states(items), { 'daily:verse': 'next', 'daily:dev': 'later', 'daily:prayer': 'later', 'event:lunch': 'later', 'event:night': 'later' });
  });
  it('counts an event as done once it has ended, and a ticked item as done', () => {
    const items = itemsFor('2026-10-28', { now: NOW, events: [ev('morning', '2026-10-28', 9, { end: dayStart('2026-10-28') + 10 * 3600000 })], ticks: { '2026-10-28': ['verse'] } });
    assert.deepEqual(states(items), { 'daily:verse': 'done', 'daily:dev': 'next', 'daily:prayer': 'later', 'event:morning': 'done' });
    assert.deepEqual(progress(items), { done: 2, total: 4 });
  });
  it('marks unticked daily items and tasks on a past day "missed", but not an event that took place', () => {
    const task = { id: 't1', title: 'Walk', date: '2026-10-20', min: 540, repeat: 'daily', done: {} };
    const items = itemsFor('2026-10-27', { now: NOW, events: [ev('cell', '2026-10-27', 19)], tasks: [task], ticks: { '2026-10-27': ['dev'] } });
    assert.deepEqual(states(items), { 'daily:verse': 'missed', 'daily:dev': 'done', 'daily:prayer': 'missed', 'task:t1': 'missed', 'event:cell': 'done' });
  });
  it('marks everything on a coming day "later"', () => {
    assert.ok(itemsFor('2026-10-29', { now: NOW }).every((i) => i.state === 'later'));
  });
  it('puts the member\'s own bookings and tasks among the items, sorted by time, and leaves out other days', () => {
    const items = itemsFor('2026-10-29', {
      now: NOW,
      bookings: [{ id: 'B1', facility: 'Foyer', date: '2026-10-29', start: '14:30', end: '16:00', status: 'Approved' }, { id: 'B2', facility: 'Foyer', date: '2026-10-30', start: '14:30', end: '16:00', status: 'Approved' }],
      tasks: [{ id: 't1', title: 'Call', date: '2026-10-29', min: 360, repeat: 'none', notes: 'Soon', done: {} }],
    });
    assert.deepEqual(items.map((i) => i.id), ['task:t1', 'daily:verse', 'daily:dev', 'daily:prayer', 'booking:B1']);
    assert.equal(items[0].sub, 'Soon');
    assert.equal(items[4].title, 'Foyer booking');
  });
  it('counts a booking as done once it has ended', () => {
    const items = itemsFor('2026-10-28', { now: NOW, bookings: [{ id: 'B1', facility: 'Foyer', date: '2026-10-28', start: '09:00', end: '10:00', status: 'Approved' }] });
    assert.equal(states(items)['booking:B1'], 'done');
  });
});

// The member's day: the three daily items, the church's events, their own room bookings and their own tasks.
// Tasks and ticks are private to this phone (localStorage "lc.tasks" and "lc.daily"); nothing here is sent anywhere.
// Used by the Home calendar and the Day plan, so both always agree.
import { dateKey, dayStart, minutesOfDay } from './util.js';

// How many days of church events the Home calendar and the Day plan ask for, so both read the same list.
export const EVENT_WINDOW = { before: 60, after: 400 };

export const TASKS_KEY = 'lc.tasks';
export const DAILY_KEY = 'lc.daily';

// The things that happen every day, in the order of the day: [id, title, minutes since midnight, sub-line].
export const DAILY = [
  { id: 'verse', title: 'Verse', full: 'Verse of the day', min: 420, sub: 'Read today’s verse · 1 min' },
  { id: 'dev', title: 'Devotion', full: 'Morning devotion', min: 435, sub: 'A few quiet minutes' },
  { id: 'prayer', title: 'Prayer', full: 'Prayer time', min: 450, sub: 'Pray for your day' },
];

const readJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ } };

// ---- Tasks: { id, title, date, min, repeat: 'none' | 'daily' | 'weekly', notes, done: { 'YYYY-MM-DD': true } } ----

export function loadTasks() {
  const list = readJson(TASKS_KEY, []);
  return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.min)) : [];
}
export const saveTasks = (list) => writeJson(TASKS_KEY, list);

export function makeTask({ id, title, date, time, repeat, notes }, previous) {
  return {
    id: id || `t${Date.now()}`,
    title: title.trim(),
    date,
    min: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
    repeat: ['daily', 'weekly'].includes(repeat) ? repeat : 'none',
    notes: (notes || '').trim(),
    done: previous?.done ?? {},
  };
}

const weekday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
export function occursOn(task, key) {
  if (key < task.date) return false;
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekly') return weekday(task.date) === weekday(key);
  return key === task.date;
}

// ---- Ticks on the daily items: { 'YYYY-MM-DD': ['verse', 'dev'] } ----

export const loadDailyTicks = () => { const v = readJson(DAILY_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };

export function setDailyTick(key, id, on) {
  const all = loadDailyTicks();
  const set = new Set(all[key] ?? []);
  if (on) set.add(id); else set.delete(id);
  if (set.size) all[key] = [...set]; else delete all[key];
  writeJson(DAILY_KEY, all);
}

export function setTaskTick(taskId, key, on) {
  const list = loadTasks().map((t) => {
    if (t.id !== taskId) return t;
    const done = { ...(t.done ?? {}) };
    if (on) done[key] = true; else delete done[key];
    return { ...t, done };
  });
  saveTasks(list);
  return list;
}

// ---- The day's items ----
// kind: 'daily' | 'event' | 'booking' | 'task'.  state: 'done' | 'next' | 'later' | 'missed'.
// Daily items and tasks are ticked by the member. Events and bookings are done once they have ended.
// Today, the first thing still to do is "Up next". A past day's unticked items are "Missed".

const TICKABLE = new Set(['daily', 'task']);

export function itemsFor(key, { events = [], bookings = [], tasks = [], ticks = {}, now = Date.now() } = {}) {
  const today = dateKey(now);
  const items = [];
  for (const d of DAILY) items.push({ kind: 'daily', ref: d.id, id: `daily:${d.id}`, title: d.title, full: d.full, sub: d.sub, min: d.min, done: (ticks[key] ?? []).includes(d.id) });
  for (const ev of events) {
    if (dateKey(ev.start) !== key) continue;
    const end = ev.end ?? ev.start + 3600000;
    items.push({ kind: 'event', ref: ev.id, id: `event:${ev.id}`, title: ev.title, full: ev.title, sub: ev.sample ? 'Sample event' : 'Church event', min: minutesOfDay(ev.start), done: end <= now, event: ev });
  }
  for (const b of bookings) {
    if (b.date !== key) continue;
    const [h1, m1] = b.start.split(':').map(Number);
    const [h2, m2] = b.end.split(':').map(Number);
    items.push({ kind: 'booking', ref: b.id ?? `${b.facility}-${b.start}`, id: `booking:${b.id ?? `${b.facility}-${b.start}`}`, title: `${b.facility} booking`, full: `${b.facility} booking`, sub: `${b.status === 'Approved' ? 'Approved' : 'Requested'} · Facilities`, min: h1 * 60 + m1, done: dayStart(key) + (h2 * 60 + m2) * 60000 <= now });
  }
  for (const t of tasks) {
    if (!occursOn(t, key)) continue;
    items.push({ kind: 'task', ref: t.id, id: `task:${t.id}`, title: t.title, full: t.title, sub: t.notes || (t.repeat === 'daily' ? 'Repeats every day · just for you' : t.repeat === 'weekly' ? 'Repeats every week · just for you' : 'Just for you'), min: t.min, done: !!t.done?.[key], task: t });
  }
  items.sort((a, b) => a.min - b.min || a.id.localeCompare(b.id));
  let nextTaken = false;
  for (const it of items) {
    if (it.done) it.state = 'done';
    else if (key < today) it.state = TICKABLE.has(it.kind) ? 'missed' : 'done';
    else if (key > today) it.state = 'later';
    else if (!nextTaken) { it.state = 'next'; nextTaken = true; } else it.state = 'later';
  }
  return items;
}

export const progress = (items) => ({ done: items.filter((i) => i.state === 'done').length, total: items.length });

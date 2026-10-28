// The Day plan (design/…/Day-Plan.dc.html): one day's items, a week strip to pick the day, and tasks you can tick, change and delete.
// It shows the church's events for the day, plus the signed-in member's own room bookings (never anyone else's).
import { data } from '../firebase.js';
import { h, fill, dateKey, addDays, dayStart, formatDay, formatClock } from '../util.js';
import { ic, eventHref } from '../ui.js';
import { loadTasks, loadDailyTicks, setDailyTick, setTaskTick, itemsFor, progress, EVENT_WINDOW } from '../planner.js';
import { myBookings } from '../my-bookings.js';
import { openTaskSheet } from '../task-sheet.js';

const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAILY_ICON = { verse: 'verse', dev: 'mic', prayer: 'heart' };
const STATUS = { done: 'Done', next: 'Up next', later: 'Later', missed: 'Missed' };
const KEY = /^\d{4}-\d{2}-\d{2}$/;

const dowOf = (key) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const mondayOf = (key) => addDays(key, -dowOf(key));

export function render(root, { date } = {}) {
  const today = dateKey();
  let sel = KEY.test(date ?? '') && !Number.isNaN(dayStart(date)) ? date : today;
  let events = [];
  let bookings = [];
  let tasks = loadTasks();
  let ticks = loadDailyTicks();
  let closeSheet = null;
  let alive = true;

  const strip = h('div', { class: 'dp-week', role: 'group', 'aria-label': 'This week' });
  const range = h('div', { class: 'dp-range' });
  const label = h('div', { class: 'dp-label' });
  const list = h('div', { class: 'dp-list' });
  const live = h('p', { class: 'sr', role: 'status' });

  const itemsOf = (key) => itemsFor(key, { events, bookings, tasks, ticks });

  const back = h('a', { class: 'round-btn dp-back', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2));
  const prev = h('button', { type: 'button', class: 'dp-step', 'aria-label': 'Previous week', onclick: () => go(addDays(sel, -7)) }, ic('back', 18, 2.2));
  const next = h('button', { type: 'button', class: 'dp-step', 'aria-label': 'Next week', onclick: () => go(addDays(sel, 7)) }, ic('right', 18, 2.2));
  const addButton = h('button', { type: 'button', class: 'dp-add', onclick: () => edit(null) }, ic('plus', 20, 2.2), 'Add task');

  root.append(h('h1', { id: 'page-title', class: 'sr', tabindex: '-1' }, 'Day plan'), back, h('div', { class: 'dp-head' }, prev, range, next), strip, label, list, h('div', { class: 'dp-addbar' }, addButton), live);

  function go(key) {
    sel = key;
    history.replaceState(null, '', `#/day/${key}`);
    document.title = `Day plan · Life Centre`;
    draw();
    loadEvents();
  }

  function edit(task) {
    closeSheet?.();
    closeSheet = openTaskSheet({ task, date: sel, onChange: (next) => { tasks = next; draw(); } });
  }

  function drawStrip() {
    const monday = mondayOf(sel);
    const sm = addDays(monday, 0);
    const em = addDays(monday, 6);
    const month = formatDay(dayStart(sel), { month: 'long' }) + (formatDay(dayStart(sel), { year: 'numeric' }) !== formatDay(Date.now(), { year: 'numeric' }) ? ` ${formatDay(dayStart(sel), { year: 'numeric' })}` : '');
    const sameMonth = formatDay(dayStart(sm), { month: 'numeric' }) === formatDay(dayStart(em), { month: 'numeric' });
    fill(range, h('span', { class: 'dp-month' }, month), h('span', { class: 'dp-dates' }, sameMonth
      ? `${formatDay(dayStart(sm), { day: 'numeric' })}–${formatDay(dayStart(em), { day: 'numeric' })}`
      : `${formatDay(dayStart(sm), { day: 'numeric', month: 'short' })} – ${formatDay(dayStart(em), { day: 'numeric', month: 'short' })}`));
    fill(strip, NAMES.map((name, j) => {
      const key = addDays(monday, j);
      const { done, total } = progress(itemsOf(key));
      const on = key === sel;
      const deg = Math.round((done / total) * 360);
      return h('button', { type: 'button', class: `dp-day${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => go(key) },
        h('span', { class: 'dow', 'aria-hidden': 'true' }, name),
        h('span', { class: 'halo', 'aria-hidden': 'true' }, h('span', { class: 'ring-box' },
          h('span', { class: `ring${done === total ? ' full' : ''}`, style: `--deg:${deg}deg` }),
          h('span', { class: `num${done ? ' some' : ''}` }, on ? `${done}/${total}` : formatDay(dayStart(key), { day: 'numeric' })))),
        h('span', { class: 'sr' }, `${name} ${formatDay(dayStart(key), { day: 'numeric' })}, ${done} of ${total} done`));
    }));
  }

  function card(it, index, hot) {
    const tickable = it.kind === 'daily' || it.kind === 'task';
    const icon = it.kind === 'daily' ? DAILY_ICON[it.ref] : it.kind === 'event' ? 'cross' : it.kind === 'booking' ? 'calendar' : 'group';
    const toggle = () => {
      const on = it.state !== 'done';
      if (it.kind === 'daily') { setDailyTick(sel, it.ref, on); ticks = loadDailyTicks(); } else tasks = setTaskTick(it.ref, sel, on);
      live.textContent = `${it.full} ${on ? 'done' : 'not done'}`;
      draw();
      list.querySelector(`[data-item="${CSS.escape(it.id)}"] .st`)?.focus();
    };
    const status = tickable
      ? h('button', { type: 'button', class: `st ${it.state}`, 'aria-pressed': String(it.state === 'done'), onclick: toggle },
        h('span', { class: 'dot', 'aria-hidden': 'true' }, it.state === 'done' ? ic('check', 12, 3) : null), STATUS[it.state], h('span', { class: 'sr' }, `, ${it.full}`))
      : h('span', { class: `st ${it.state}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }, it.state === 'done' ? ic('check', 12, 3) : null), STATUS[it.state]);
    const act = it.kind === 'task' ? h('button', { type: 'button', class: 'dp-act', 'aria-label': `Edit ${it.full}`, onclick: () => edit(it.task) }, 'Edit', ic('right', 14, 2))
      : it.kind === 'event' ? h('a', { class: 'dp-act', href: eventHref(it.event), 'aria-label': `Details of ${it.full}` }, 'Details', ic('right', 14, 2))
        : it.kind === 'booking' ? h('a', { class: 'dp-act', href: '#/booking', 'aria-label': `Details of ${it.full}` }, 'Details', ic('right', 14, 2)) : h('span');
    return h('article', { class: `dp-card${hot ? ' hot' : ''}${it.state === 'missed' ? ' missed' : ''}`, 'data-item': it.id },
      h('div', { class: 'row' },
        h('span', { class: 'disc', 'aria-hidden': 'true' }, ic(icon, 20, 1.8)),
        h('span', { class: 'what' }, h('b', {}, it.full), h('small', {}, it.sub)),
        status),
      h('div', { class: 'row' }, h('span', { class: 'time' }, formatClock(it.min)), act));
  }

  function draw() {
    drawStrip();
    const items = itemsOf(sel);
    const { done, total } = progress(items);
    const isToday = sel === today;
    fill(label, h('b', {}, 'Schedule'), h('span', {}, isToday ? `Today, ${formatDay(dayStart(sel), { day: 'numeric', month: 'short' })}` : formatDay(dayStart(sel), { weekday: 'short', day: 'numeric', month: 'short' })), h('span', {}, `· ${done} of ${total} done`));
    // Today: what is coming first, then what is done. Other days: in time order.
    const order = isToday ? [...items].sort((a, b) => (a.state === 'next' ? 0 : a.state === 'done' ? 2 : 1) - (b.state === 'next' ? 0 : b.state === 'done' ? 2 : 1) || a.min - b.min) : items;
    const firstLater = !isToday && sel > today ? order.findIndex((i) => i.state !== 'done') : -1;
    fill(list, order.map((it, k) => card(it, k, it.state === 'next' || k === firstLater)));
  }

  async function loadEvents() {
    const from = dayStart(addDays(today, -EVENT_WINDOW.before));
    const to = dayStart(addDays(today, EVENT_WINDOW.after));
    const result = await data.getEvents({ from, to, key: 'events' });
    if (!alive) return;
    events = result.value;
    list.dataset.events = 'loaded';
    draw();
  }

  draw();
  loadEvents();
  myBookings().then((b) => { if (alive) { bookings = b; draw(); } });

  return () => { alive = false; closeSheet?.(); };
}

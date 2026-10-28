// The "Add a task" / "Change your task" sheet, shared by Home and the Day plan (design: Main.dc.html and Day-Plan.dc.html).
// A task is private to this phone. "Add to my own calendar" only opens the member's own calendar app.
import { h } from './util.js';
import { ic } from './ui.js';
import { loadTasks, saveTasks, makeTask } from './planner.js';

const REPEATS = [['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekly', 'Every week']];
const pad = (n) => String(n).padStart(2, '0');
const clock = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function calendarLinks(f) {
  const ymd = f.date.replace(/-/g, '');
  const hm = f.time.replace(':', '');
  const endHm = `${pad(Math.min(23, Number(hm.slice(0, 2)) + 1))}${hm.slice(2)}`;
  const rrule = f.repeat === 'daily' ? 'FREQ=DAILY' : f.repeat === 'weekly' ? 'FREQ=WEEKLY' : '';
  const title = f.title.trim();
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${ymd}T${hm}00/${ymd}T${endHm}00&details=${encodeURIComponent(f.notes || '')}${rrule ? `&recur=${encodeURIComponent(`RRULE:${rrule}`)}` : ''}`;
  const clean = (s) => s.replace(/\r?\n/g, ' ').replace(/[,;]/g, ' ');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Centre//Planner//EN', 'BEGIN:VEVENT', `UID:${f.id || 'new'}-${ymd}${hm}@lifecentre.sg`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${ymd}T${hm}00`, `DTEND:${ymd}T${endHm}00`, rrule ? `RRULE:${rrule}` : null, `SUMMARY:${clean(title)}`, `DESCRIPTION:${clean(f.notes || '')}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  return { google, ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` };
}

// opts: { task (to change one, else a new task), date ('YYYY-MM-DD' to start with), onChange(list) }. Returns a function that closes the sheet.
export function openTaskSheet({ task = null, date, onChange = () => {} }) {
  const opener = document.activeElement;
  const editing = !!task;
  const f = { id: task?.id ?? null, title: task?.title ?? '', date: task?.date ?? date, time: task ? clock(task.min) : '09:00', repeat: task?.repeat ?? 'none', notes: task?.notes ?? '' };
  const heading = editing ? 'Change your task' : 'Add a task';

  const wrap = h('div', { class: 'sheet-wrap task-sheet' });
  const error = h('p', { class: 'note bk-error', role: 'alert', hidden: '' });
  const complain = (text, field) => { error.textContent = text; error.hidden = false; field?.focus(); };
  const close = () => { wrap.remove(); try { opener?.focus?.({ preventScroll: true }); } catch { /* the opener may be gone */ } };
  const done = (list) => { onChange(list); close(); };

  const field = (label, control) => h('label', { class: 'bk-field' }, h('span', {}, label), control);
  const titleInput = h('input', { name: 'task-title', type: 'text', maxlength: '120', placeholder: 'e.g. Walk, call a friend, read Psalm 23', value: f.title, oninput: (e) => { f.title = e.target.value; links(); } });
  const dateInput = h('input', { name: 'task-date', type: 'date', value: f.date, oninput: (e) => { f.date = e.target.value; links(); }, onchange: (e) => { f.date = e.target.value; links(); } });
  const timeInput = h('input', { name: 'task-time', type: 'time', value: f.time, oninput: (e) => { f.time = e.target.value; links(); }, onchange: (e) => { f.time = e.target.value; links(); } });
  const repeatInput = h('select', { name: 'task-repeat', onchange: (e) => { f.repeat = e.target.value; links(); } }, REPEATS.map(([v, label]) => h('option', { value: v, selected: v === f.repeat }, label)));
  const notesInput = h('textarea', { name: 'task-notes', class: 'cr-area', rows: '2', maxlength: '500', oninput: (e) => { f.notes = e.target.value; links(); } }, f.notes);
  const google = h('a', { class: 'btn', href: '#', target: '_blank', rel: 'noopener' }, 'Google Calendar');
  const apple = h('a', { class: 'btn', href: '#', download: 'my-task.ics' }, 'Apple / Outlook');
  function links() {
    const ready = f.title.trim() && f.date && f.time;
    const l = ready ? calendarLinks(f) : { google: '#', ics: '#' };
    google.setAttribute('href', l.google);
    apple.setAttribute('href', l.ics);
    for (const a of [google, apple]) a.toggleAttribute('aria-disabled', !ready);
  }
  links();

  const save = () => {
    if (!f.title.trim()) { complain('Please say what the task is.', titleInput); return; }
    if (!f.date || !f.time) { complain('Please choose a date and a time.', f.date ? timeInput : dateInput); return; }
    const list = loadTasks();
    const previous = editing ? list.find((t) => t.id === f.id) : null;
    const record = makeTask(f, previous);
    const next = editing ? list.map((t) => (t.id === f.id ? record : t)) : [...list, record];
    saveTasks(next);
    done(next);
  };

  const askBox = h('div', { class: 'sheet-confirm', hidden: '' },
    h('b', {}, 'Delete this task for good?'),
    h('div', { class: 'sheet-confirm-row' },
      h('button', { type: 'button', class: 'btn danger', onclick: () => { const next = loadTasks().filter((t) => t.id !== f.id); saveTasks(next); done(next); } }, 'Yes, delete'),
      h('button', { type: 'button', class: 'btn', onclick: () => { askBox.hidden = true; deleteButton.hidden = false; deleteButton.focus(); } }, 'Keep it')));
  const deleteButton = h('button', { type: 'button', class: 'sheet-delete', hidden: editing ? null : '', onclick: () => { askBox.hidden = false; deleteButton.hidden = true; askBox.querySelector('button').focus(); } }, 'Delete this task');

  const dialog = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': heading },
    h('div', { class: 'sheet-top' }, h('h2', {}, heading), h('button', { type: 'button', class: 'round-btn sheet-x', 'aria-label': 'Close', onclick: close }, ic('close', 18, 2.2))),
    h('form', { class: 'bk-form', novalidate: '', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('What do you want to do?', titleInput),
      h('div', { class: 'bk-times' }, field('Date', dateInput), field('Time', timeInput)),
      field('Repeat', repeatInput),
      editing && f.repeat !== 'none' ? h('p', { class: 'note' }, 'Changing this changes every day it repeats.') : null,
      field('Notes (optional)', notesInput),
      error,
      h('button', { type: 'submit', class: 'sheet-done' }, 'Save')),
    h('div', { class: 'sheet-cal' }, h('b', {}, 'Add to my own calendar'), h('div', { class: 'sheet-confirm-row' }, google, apple), h('small', {}, 'Opens in your own calendar app. Nothing is sent to the church.')),
    deleteButton, askBox,
    h('small', { class: 'sheet-foot' }, 'Your tasks are saved on this phone only.'));

  wrap.append(h('button', { type: 'button', class: 'sheet-back', 'aria-label': 'Close', tabindex: '-1', onclick: close }), dialog);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input, select, textarea, button, a[href]')].filter((el) => !el.hidden && !el.closest('[hidden]') && el.tabIndex >= 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.querySelector('.app').append(wrap);
  titleInput.focus();
  return close;
}

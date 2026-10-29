// Facilities booking (design/Booking-SignedOut.dc.html and design/Booking.dc.html).
// Members sign in with an emailed 6-digit code, then book a room through the church's existing booking system.
// The design has no "New booking" form, so the form here uses the fields the existing booking page asks for.
import { h, fill, addDays, dayStart, formatDay } from '../util.js';
import { ic } from '../ui.js';
import { load, save } from '../local.js';
import { api, getSession, clearSession } from '../booking-api.js';
import { forgetMyBookings } from '../my-bookings.js';
import { memberSignIn } from '../member-signin.js';

const LAST_ORG = 'bookingOrg';
const STATUS = {
  Approved: ['Approved', '#2E9E5B'],
  Requested: ['Pending', '#B86E00'],
  'Needs information': ['Pending', '#B86E00'],
  Rejected: ['Not approved', '#6B7588'],
  Cancelled: ['Cancelled', '#6B7588'],
};

const toMinutes = (hhmm) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
const toClock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const day = (ymd) => formatDay(dayStart(ymd));

export function render(root) {
  let view = getSession() ? 'home' : 'email'; // email (the shared sign-in form) | home | form | done
  let notice = '';
  let signin = null; // the sign-in form, kept between redraws so what was typed survives
  let error = '';
  let busy = false;
  let cfg = null;
  let mine = null;
  let result = null;
  let form = null;
  let blocks = [];
  let blocksSeq = 0;
  let loaded = false; // the day's bookings have been fetched for the chosen room and date

  const host = h('div', { class: 'stack' });
  root.append(host);

  const user = () => getSession();
  const say = (text) => { error = text; draw(); };

  // Anything that fails: a lost session goes back to sign-in, the rest shows a message.
  function fail(e) {
    busy = false;
    if (e.code === 'signin') { view = 'email'; notice = 'Your sign-in ended. Please sign in again.'; error = ''; signin = null; } else error = e.message;
    draw();
  }

  async function loadHome() {
    busy = true; error = ''; draw();
    try {
      [cfg, mine] = await Promise.all([api('config'), api('myBookings')]);
    } catch (e) { return fail(e); }
    busy = false; draw();
  }

  async function signOut() {
    try { await api('signOut'); } catch { /* the session is forgotten on this phone either way */ }
    clearSession();
    view = 'email'; notice = ''; error = ''; signin = null; cfg = null; mine = null;
    draw();
  }

  function openForm(room) {
    const start = '09:00';
    form = { room, date: addDays(cfg.today, 1), start, end: '10:00', org: load(LAST_ORG, ''), purpose: '', attendance: '', setup: '' };
    view = 'form'; error = ''; blocks = []; loaded = false;
    draw();
    loadBlocks();
  }

  async function loadBlocks() {
    const mySeq = ++blocksSeq;
    loaded = false;
    if (!form.date || form.date < cfg.today || form.date > cfg.maxDate) { blocks = []; draw(); return; }
    try {
      const r = await api('availability', { facility: form.room, date: form.date });
      if (mySeq !== blocksSeq) return;
      blocks = r.blocks; loaded = true;
    } catch (e) { if (mySeq === blocksSeq) return fail(e); }
    draw();
  }

  const clash = () => {
    const s = toMinutes(form.start);
    const e = toMinutes(form.end);
    return blocks.some((b) => b.kind === 'booked' && s < toMinutes(b.end) && e > toMinutes(b.start));
  };
  const ready = () => form.org.trim() && form.purpose.trim() && /^\d{1,5}$/.test(form.attendance.trim()) && toMinutes(form.end) > toMinutes(form.start)
    && form.date >= cfg.today && form.date <= cfg.maxDate && !clash();

  async function book() {
    if (busy || !ready()) return;
    busy = true; error = ''; draw();
    try {
      result = await api('book', { facility: form.room, date: form.date, start: form.start, end: form.end, org: form.org.trim(), purpose: form.purpose.trim(), attendance: form.attendance.trim(), setupNeeds: form.setup.trim() });
      save(LAST_ORG, form.org.trim());
      forgetMyBookings();
      view = 'done';
    } catch (e) { return fail(e); }
    busy = false; draw();
  }

  // ---- pieces ----

  const head = (first, second, back) => h('header', { class: 'bk-head' },
    h('div', { class: 'bk-head-top' }, back, user() ? h('span', { class: 'bk-avatar', 'aria-hidden': 'true' }, (user().name || user().email || '?').trim()[0].toUpperCase()) : null),
    h('h1', { id: 'page-title', tabindex: '-1' }, first, second ? h('span', { class: 'light' }, ` ${second}`) : null));
  const backHome = h('a', { class: 'round-btn', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2));
  const status = (s) => { const [label, colour] = STATUS[s] ?? [s, '#6B7588']; return h('span', { class: 'bk-status' }, h('span', { class: 'bk-dot', style: `background:${colour}`, 'aria-hidden': 'true' }), label); };
  const alertBox = () => (error ? h('p', { class: 'note bk-error', role: 'alert' }, error) : null);
  const field = (label, control) => h('label', { class: 'bk-field' }, h('span', {}, label), control);
  const timeOptions = (from, to, selected) => {
    const out = [];
    for (let m = toMinutes(from); m <= toMinutes(to); m += 30) out.push(h('option', { value: toClock(m), selected: toClock(m) === selected }, toClock(m)));
    return out;
  };

  function signInView() {
    signin ??= memberSignIn({ notice, intro: 'We’ll email you a 6‑digit code. No password needed.', onDone: () => { signin = null; notice = ''; view = 'home'; loadHome(); } });
    return [
      head('Facilities Booking', 'Request', backHome),
      h('section', { class: 'bk-frame' }, h('div', { class: 'bk-inner' },
        h('h2', { class: 'big' }, 'Sign in to book a room'),
        signin.el),
        h('a', { class: 'bk-contact', href: '#/contact' }, h('span', {}, 'Not a member yet?'), h('b', {}, 'Contact us')))];
  }

  function homeView() {
    const u = user();
    const header = head('Facilities Booking', 'Request', backHome);
    if (!cfg || !mine) return [header, h('p', { class: 'note', role: 'status' }, error || 'Loading…'), error ? h('button', { type: 'button', class: 'btn', onclick: loadHome }, 'Try again') : null];
    const room = form?.room ?? (cfg.rooms.includes('Empower Room') ? 'Empower Room' : cfg.rooms[0]);
    const row = (b) => h('div', { class: 'bk-item' },
      h('span', { class: 'bk-what' }, h('b', {}, b.facility), h('small', {}, `${day(b.date)} · ${b.start}–${b.end}`), b.org ? h('small', {}, b.org) : null),
      status(b.status));
    const list = (items) => (items.length ? h('div', { class: 'card rows' }, ...items.map(row)) : null);
    return [
      head('Facilities Booking', 'Request', backHome),
      h('section', { class: 'card bk-card', 'aria-label': 'Rooms' },
        h('h2', { class: 'bk-label' }, 'Choose a room'),
        h('div', { class: 'bk-rooms' }, cfg.rooms.map((r) => h('button', { type: 'button', class: 'bk-room', 'aria-pressed': String(r === room), onclick: () => { form = { ...(form ?? {}), room: r }; draw(); } }, r))),
        h('button', { type: 'button', class: 'cr-submit', onclick: () => openForm(room) }, ic('plus', 18, 2.2), ' New booking')),
      h('h2', { class: 'big-title' }, 'Your bookings'),
      list(mine.upcoming) ?? h('p', { class: 'note' }, 'No upcoming bookings.'),
      mine.past.length ? h('h2', { class: 'big-title' }, 'Earlier') : null,
      mine.past.length ? list(mine.past) : null,
      alertBox(),
      h('div', { class: 'bk-signed' }, h('span', { class: 'muted' }, `Signed in as ${u?.email ?? ''}`), h('button', { type: 'button', class: 'btn', onclick: signOut }, 'Sign out'))];
  }

  function formView() {
    const back = h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Back to your bookings', onclick: () => { view = 'home'; error = ''; draw(); } }, ic('back', 20, 2.2));
    const set = (patch, reload) => { form = { ...form, ...patch }; if (reload) { draw(); loadBlocks(); } else draw(); };
    const taken = clash();
    const overlaps = (kind, from, to) => blocks.some((b) => b.kind === kind && from < toMinutes(b.end) && to > toMinutes(b.start));
    // One tap picks an hour; tapping the hour just after or just before the chosen time extends it.
    const tapSlot = (from) => {
      const to = from + 60;
      const s = toMinutes(form.start);
      const e = toMinutes(form.end);
      const inside = from >= s && to <= e;
      const next = !inside && from === e ? { start: form.start, end: toClock(to) }
        : !inside && to === s ? { start: toClock(from), end: form.end }
          : { start: toClock(from), end: toClock(to) };
      set(next);
      host.querySelector(`[data-slot="${toClock(from)}"]`)?.focus();
    };
    const slots = [];
    for (let m = toMinutes(cfg.dayStart); m + 60 <= toMinutes(cfg.dayEnd); m += 60) slots.push(m);
    const slotButton = (m) => {
      const isBooked = overlaps('booked', m, m + 60);
      const chosen = !isBooked && m >= toMinutes(form.start) && m + 60 <= toMinutes(form.end);
      const requested = !isBooked && overlaps('pending', m, m + 60);
      return h('button', {
        type: 'button', class: `bk-slot${isBooked ? ' is-booked' : ''}`, 'data-slot': toClock(m),
        'aria-pressed': isBooked ? null : String(chosen), disabled: isBooked ? '' : null,
        onclick: () => tapSlot(m),
      }, h('b', {}, toClock(m)), isBooked ? h('small', {}, 'Booked') : requested ? h('small', {}, 'Requested') : null);
    };
    return [
      head('New booking', '', back),
      h('form', { class: 'stack', novalidate: '', onsubmit: (e) => { e.preventDefault(); book(); } },
        h('section', { class: 'card bk-card' },
          field('Room', h('select', { name: 'room', onchange: (e) => set({ room: e.target.value }, true) }, cfg.rooms.map((r) => h('option', { value: r, selected: r === form.room }, r)))),
          field('Date', h('input', { name: 'date', type: 'date', value: form.date, min: cfg.today, max: cfg.maxDate, onchange: (e) => set({ date: e.target.value }, true) })),
          loaded ? h('div', { class: 'bk-slots', role: 'group', 'aria-label': 'Hours on this day. Tap an hour, tap the next hour to make it longer.' }, slots.map(slotButton)) : null,
          h('div', { class: 'bk-times' },
            field('Start', h('select', { name: 'start', onchange: (e) => { const start = e.target.value; set({ start, end: toMinutes(form.end) > toMinutes(start) ? form.end : toClock(Math.min(toMinutes(start) + 60, toMinutes(cfg.dayEnd))) }); } }, timeOptions(cfg.dayStart, toClock(toMinutes(cfg.dayEnd) - 30), form.start))),
            field('End', h('select', { name: 'end', onchange: (e) => set({ end: e.target.value }) }, timeOptions(toClock(toMinutes(form.start) + 30), cfg.dayEnd, form.end)))),
          h('p', { class: taken ? 'note bk-error' : 'note', role: 'status' },
            !loaded ? 'Checking the day…' : taken ? 'That time is already booked for this room.' : 'Tap an hour, or the next one to make it longer. You can also change the start and end by hand.')),
        h('section', { class: 'card bk-card' },
          field('Ministry or organisation', h('input', { name: 'org', type: 'text', maxlength: '160', value: form.org, oninput: (e) => { form.org = e.target.value; refresh(); } })),
          field('What is the event?', h('input', { name: 'purpose', type: 'text', maxlength: '300', value: form.purpose, oninput: (e) => { form.purpose = e.target.value; refresh(); } })),
          field('Expected attendance', h('input', { name: 'attendance', type: 'number', inputmode: 'numeric', min: '1', max: '99999', value: form.attendance, oninput: (e) => { form.attendance = e.target.value; refresh(); } })),
          field('Setup and AV needs (optional)', h('textarea', { name: 'setup', class: 'cr-area', maxlength: '1000', rows: '3', oninput: (e) => { form.setup = e.target.value; } }, form.setup))),
        alertBox(),
        h('button', { type: 'submit', id: 'bk-submit', class: 'cr-submit', disabled: busy || !ready() ? '' : null }, busy ? 'Booking…' : 'Book room'))];
  }

  // Typing must not redraw the form (it would lose the cursor), so only the submit button is updated.
  function refresh() {
    const b = host.querySelector('#bk-submit');
    if (b) b.toggleAttribute('disabled', busy || !ready());
  }

  function doneView() {
    const approved = result.status === 'Approved';
    return [
      head(approved ? 'Booked' : 'Request received', '', backHome),
      h('section', { class: 'card done' },
        h('span', { class: 'done-ic', 'aria-hidden': 'true' }, ic('check', 28, 2.6)),
        h('h2', { class: 'big' }, result.facility),
        h('p', { class: 'muted' }, `${day(result.date)} · ${result.start}–${result.end}`),
        h('p', { class: 'muted' }, `Reference ${result.bookingId}. A confirmation is on its way to ${user()?.email ?? 'your email'}.`),
        h('button', { type: 'button', class: 'btn primary', onclick: () => { result = null; view = 'home'; loadHome(); } }, 'Done'),
        h('button', { type: 'button', class: 'btn', onclick: () => { const room = result.facility; result = null; openForm(room); } }, 'Book another'))];
  }

  function draw() {
    const nodes = view === 'email' ? signInView() : view === 'home' ? homeView() : view === 'form' ? formView() : doneView();
    fill(host, nodes);
  }

  draw();
  if (view === 'home') loadHome();
}

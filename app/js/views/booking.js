// Book a space (design boards 16b, 16c and 16d on the design canvas).
// One page: pick a space and a day from swipeable pills, read the day's timeline, pick the hours, then Confirm.
// Confirm opens the booking details on the same page. Below are the member's bookings and earlier bookings, each a
// sideways slider; an earlier booking can be booked again (Rebook) with its details filled in.
// Members sign in on the Account page (#/account), which brings them back here.
import { h, fill, addDays, dayStart, formatDay, enableDragScroll } from '../util.js';
import { ic } from '../ui.js';
import { load, save } from '../local.js';
import { api, getSession, clearSession } from '../booking-api.js';
import { forgetMyBookings } from '../my-bookings.js';

const LAST_ORG = 'bookingOrg';
const DAYS_SHOWN = 60; // date pills; any later date (up to the booking limit) is reached with "Other date"
const STATUS = {
  Approved: ['Approved', 'ok'],
  Requested: ['Pending', 'wait'],
  'Needs information': ['Pending', 'wait'],
  Rejected: ['Not approved', 'off'],
  Cancelled: ['Cancelled', 'off'],
};

const toMinutes = (hhmm) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
const toClock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const day = (ymd) => formatDay(dayStart(ymd));
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const hoursLabel = (s, e) => { const m = toMinutes(e) - toMinutes(s); const hrs = m / 60; return `${hrs % 1 ? hrs.toFixed(1) : hrs} ${hrs === 1 ? 'hour' : 'hours'}`; };

export function render(root) {
  // Signed out: there is one sign-in page, Account. It brings the member back here after the code.
  const toSignIn = (ended) => location.replace(`#/account?next=booking${ended ? '&ended=1' : ''}`);
  if (!getSession()) { toSignIn(false); return; }

  let cfg = null;
  let mine = null;
  let error = '';
  let busy = false;
  let pick = null; // { room, date, start, end }
  let blocks = [];
  let blocksSeq = 0;
  let loaded = false; // the day's bookings have been fetched for the chosen space and date
  let open = false; // the booking details are open (after Confirm)
  let details = { org: load(LAST_ORG, ''), purpose: '', attendance: '', setup: '' };
  let rebook = null; // the earlier booking being booked again
  let note = ''; // a clash found while rebooking
  let result = null; // the answer to "book"
  let showPicker = false;

  const host = h('div', { class: 'stack bs' });
  root.append(host);
  const user = () => getSession();

  function fail(e) {
    busy = false;
    if (e.code === 'signin') { toSignIn(true); return; }
    error = e.message;
    draw();
  }

  async function loadAll() {
    busy = true; error = ''; draw();
    try {
      [cfg, mine] = await Promise.all([api('config'), api('myBookings')]);
    } catch (e) { return fail(e); }
    busy = false;
    if (!pick) {
      const room = cfg.rooms.includes('Empower Room') ? 'Empower Room' : cfg.rooms[0];
      pick = { room, date: addDays(cfg.today, 1), start: '09:00', end: '10:00' };
    }
    draw();
    loadBlocks();
  }

  async function loadBlocks() {
    const mySeq = ++blocksSeq;
    loaded = false;
    if (!pick.date || pick.date < cfg.today || pick.date > cfg.maxDate) { blocks = []; draw(); return; }
    try {
      const r = await api('availability', { facility: pick.room, date: pick.date });
      if (mySeq !== blocksSeq) return;
      blocks = r.blocks; loaded = true;
    } catch (e) { if (mySeq === blocksSeq) return fail(e); }
    // Rebooking: the same hours on the new day, if they are free.
    if (rebook && !open) {
      if (clash()) note = `${rebook.purpose || 'This booking'} clashes with a booking on ${day(pick.date)} at ${pick.start}–${pick.end}. Choose another time or date and the details stay filled in.`;
      else { note = ''; open = true; }
    }
    draw();
  }

  const overlaps = (kind, from, to) => blocks.some((b) => b.kind === kind && from < toMinutes(b.end) && to > toMinutes(b.start));
  const clash = () => overlaps('booked', toMinutes(pick.start), toMinutes(pick.end));
  const timeOk = () => toMinutes(pick.end) > toMinutes(pick.start) && pick.date >= cfg.today && pick.date <= cfg.maxDate && loaded && !clash();
  const ready = () => timeOk() && details.org.trim() && details.purpose.trim() && /^\d{1,5}$/.test(details.attendance.trim());

  // A change of space, date or time: the details stay as typed, only the check of the day starts again.
  function setPick(patch, reload) {
    pick = { ...pick, ...patch };
    error = ''; result = null; note = '';
    if (reload) { draw(); loadBlocks(); } else draw();
  }

  async function book() {
    if (busy || !ready()) return;
    busy = true; error = ''; draw();
    try {
      result = await api('book', { facility: pick.room, date: pick.date, start: pick.start, end: pick.end, org: details.org.trim(), purpose: details.purpose.trim(), attendance: details.attendance.trim(), setupNeeds: details.setup.trim() });
      save(LAST_ORG, details.org.trim());
      forgetMyBookings();
      open = false; rebook = null;
      details = { org: details.org.trim(), purpose: '', attendance: '', setup: '' };
      mine = await api('myBookings');
    } catch (e) { return fail(e); }
    busy = false; draw();
    host.querySelector('.bs-done')?.focus();
    loadBlocks();
  }

  async function signOut() {
    try { await api('signOut'); } catch { /* the session is forgotten on this phone either way */ }
    clearSession();
    toSignIn(false);
  }

  function startRebook(b) {
    // The next same weekday from tomorrow, the same hours, the same details.
    let date = addDays(cfg.today, 1);
    while (weekday(date) !== weekday(b.date)) date = addDays(date, 1);
    if (date > cfg.maxDate) date = cfg.maxDate;
    rebook = b;
    open = false; result = null; error = '';
    details = { org: b.org ?? details.org, purpose: b.purpose ?? '', attendance: b.attendance ? String(b.attendance) : '', setup: '' };
    pick = { room: cfg.rooms.includes(b.facility) ? b.facility : pick.room, date, start: b.start, end: b.end };
    host.closest('.screen')?.scrollTo({ top: 0, behavior: 'smooth' });
    draw();
    loadBlocks();
  }

  // ---- pieces ----

  const initial = () => ((user()?.name || user()?.email || '?').trim()[0] || '?').toUpperCase();
  const head = () => h('header', { class: 'bk-head' },
    h('div', { class: 'bk-head-top' },
      h('a', { class: 'round-btn', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2)),
      h('a', { class: 'bk-avatar', href: '#/account', 'aria-label': `Account, signed in as ${user()?.email ?? ''}` }, initial())),
    h('h1', { id: 'page-title', tabindex: '-1' }, 'Book a space'));
  const alertBox = () => (error ? h('p', { class: 'note bk-error', role: 'alert' }, error) : null);
  const field = (label, control) => h('label', { class: 'bk-field' }, h('span', {}, label), control);
  const timeOptions = (from, to, selected) => {
    const out = [];
    for (let m = toMinutes(from); m <= toMinutes(to); m += 30) out.push(h('option', { value: toClock(m), selected: toClock(m) === selected }, toClock(m)));
    return out;
  };
  const statusBadge = (s) => { const [label, tone] = STATUS[s] ?? [s, 'off']; return h('span', { class: `bs-badge is-${tone}` }, h('span', { class: 'bs-dot', 'aria-hidden': 'true' }), label); };
  const strip = (id, label, items) => {
    const el = h('div', { id, class: 'h-scroll drag-x bs-strip', role: 'group', 'aria-label': label }, items);
    enableDragScroll(el, 'x');
    return el;
  };

  function spaces() {
    return h('section', { class: 'bs-spaces', 'aria-labelledby': 'bs-space-h' },
      h('h2', { id: 'bs-space-h', class: 'bs-label' }, 'Space'),
      strip('bs-rooms', 'Spaces', cfg.rooms.map((r) => h('button', {
        type: 'button', class: 'bs-pill', 'aria-pressed': String(r === pick.room),
        onclick: () => { if (r !== pick.room) setPick({ room: r }, true); },
      }, r))));
  }

  function dates() {
    const last = [addDays(cfg.today, DAYS_SHOWN - 1), cfg.maxDate].sort()[0];
    const pills = [];
    for (let d = cfg.today; d <= last; d = addDays(d, 1)) {
      const ms = dayStart(d);
      const first = d === cfg.today || d.endsWith('-01');
      pills.push(h('button', {
        type: 'button', class: 'bs-day', 'data-date': d, 'aria-pressed': String(d === pick.date),
        onclick: () => { if (d !== pick.date) { showPicker = false; setPick({ date: d }, true); } },
      },
      h('span', { class: 'bs-wd' }, d === cfg.today ? 'Today' : formatDay(ms, { weekday: 'short' })),
      h('span', { class: 'bs-num' }, formatDay(ms, { day: 'numeric' })),
      h('span', { class: 'bs-mon' }, first ? formatDay(ms, { month: 'short' }) : '')));
    }
    return [
      h('div', { class: 'bs-row' },
        h('h2', { class: 'bs-month' }, formatDay(dayStart(pick.date), { month: 'long', year: 'numeric' })),
        h('button', { type: 'button', class: 'bs-other', 'aria-expanded': String(showPicker), onclick: () => { showPicker = !showPicker; draw(); if (showPicker) host.querySelector('[name="date"]')?.focus(); } }, ic('calendar', 16, 2), 'Other date')),
      showPicker ? field('Jump to a date', h('input', { name: 'date', type: 'date', value: pick.date, min: cfg.today, max: cfg.maxDate, onchange: (e) => { if (e.target.value) { showPicker = false; setPick({ date: e.target.value }, true); } } })) : null,
      strip('bs-days', 'Days', pills),
    ];
  }

  function timeline() {
    const span = toMinutes(cfg.dayEnd) - toMinutes(cfg.dayStart);
    const pos = (from, to) => `left:${((toMinutes(from) - toMinutes(cfg.dayStart)) / span * 100).toFixed(3)}%;width:${((toMinutes(to) - toMinutes(from)) / span * 100).toFixed(3)}%`;
    const marks = [];
    for (let m = toMinutes(cfg.dayStart); m <= toMinutes(cfg.dayEnd); m += 240) marks.push(h('span', {}, toClock(m)));
    return h('div', { class: 'bs-day-plan' },
      h('h3', { class: 'bs-day-title' }, formatDay(dayStart(pick.date), { weekday: 'long', day: 'numeric', month: 'long' })),
      h('div', { class: 'bs-line', role: 'img', 'aria-label': loaded ? `${blocks.filter((b) => b.kind === 'booked').length} booked, ${blocks.filter((b) => b.kind === 'pending').length} requested on this day` : 'Checking the day' },
        loaded ? blocks.map((b) => h('span', { class: `bs-block is-${b.kind === 'booked' ? 'booked' : 'requested'}`, style: pos(b.start, b.end) })) : null,
        toMinutes(pick.end) > toMinutes(pick.start) ? h('span', { class: 'bs-block is-mine', style: pos(pick.start, pick.end) }) : null),
      h('div', { class: 'bs-marks', 'aria-hidden': 'true' }, marks),
      h('div', { class: 'bs-legend' },
        h('span', {}, h('i', { class: 'is-booked', 'aria-hidden': 'true' }), 'Booked'),
        h('span', {}, h('i', { class: 'is-requested', 'aria-hidden': 'true' }), 'Requested, not yet confirmed'),
        h('span', {}, h('i', { class: 'is-mine', 'aria-hidden': 'true' }), 'Your choice')));
  }

  function hours() {
    // One tap picks an hour; tapping the hour just after or just before the chosen time extends it.
    const tapSlot = (from) => {
      const to = from + 60;
      const s = toMinutes(pick.start);
      const e = toMinutes(pick.end);
      const inside = from >= s && to <= e;
      const next = !inside && from === e ? { start: pick.start, end: toClock(to) }
        : !inside && to === s ? { start: toClock(from), end: pick.end }
          : { start: toClock(from), end: toClock(to) };
      setPick(next);
      // after the browser has finished the tap (a mouse tap would otherwise leave focus on the page)
      requestAnimationFrame(() => host.querySelector(`[data-slot="${toClock(from)}"]`)?.focus());
    };
    const slots = [];
    for (let m = toMinutes(cfg.dayStart); m + 60 <= toMinutes(cfg.dayEnd); m += 60) slots.push(m);
    const slotButton = (m) => {
      const isBooked = overlaps('booked', m, m + 60);
      const chosen = !isBooked && m >= toMinutes(pick.start) && m + 60 <= toMinutes(pick.end);
      const requested = !isBooked && overlaps('pending', m, m + 60);
      return h('button', {
        type: 'button', class: `bk-slot${isBooked ? ' is-booked' : requested ? ' is-requested' : ''}`, 'data-slot': toClock(m),
        'aria-pressed': isBooked ? null : String(chosen), disabled: isBooked ? '' : null,
        onclick: () => tapSlot(m),
      }, h('b', {}, toClock(m)), isBooked ? h('small', {}, 'Booked') : requested ? h('small', {}, 'Requested') : null);
    };
    const taken = loaded && clash();
    const valid = toMinutes(pick.end) > toMinutes(pick.start);
    return h('div', { class: 'bs-hours' },
      h('div', { class: 'bs-row' }, h('h3', { class: 'bs-sub' }, 'Time'), valid ? h('span', { class: 'bs-sum' }, `${pick.start} – ${pick.end} · ${hoursLabel(pick.start, pick.end)}`) : null),
      loaded ? h('div', { class: 'bk-slots', role: 'group', 'aria-label': 'Hours on this day' }, slots.map(slotButton)) : h('p', { class: 'note', role: 'status' }, 'Checking the day…'),
      h('div', { class: 'bk-times' },
        field('Start', h('select', { name: 'start', onchange: (e) => { const start = e.target.value; setPick({ start, end: toMinutes(pick.end) > toMinutes(start) ? pick.end : toClock(Math.min(toMinutes(start) + 60, toMinutes(cfg.dayEnd))) }); } }, timeOptions(cfg.dayStart, toClock(toMinutes(cfg.dayEnd) - 30), pick.start))),
        field('End', h('select', { name: 'end', onchange: (e) => setPick({ end: e.target.value }) }, timeOptions(toClock(toMinutes(pick.start) + 30), cfg.dayEnd, pick.end)))),
      taken ? h('p', { class: 'note bs-clash', role: 'status' }, 'That time is already booked for this space.') : null,
      note ? h('p', { class: 'note bs-clash', role: 'status' }, note) : null);
  }

  function detailsForm() {
    const keep = (name) => (e) => { details[name] = e.target.value; refresh(); };
    return h('form', { class: 'bs-details', novalidate: '', onsubmit: (e) => { e.preventDefault(); book(); } },
      rebook ? h('p', { class: 'bs-rebook', role: 'status' }, ic('repeat', 16, 2.2), `Rebooking ${rebook.purpose || rebook.facility} from ${day(rebook.date)}. Same details, new date.`) : null,
      h('div', { class: 'bs-summary' },
        h('span', { class: 'acct-what' }, h('b', {}, pick.room), h('small', {}, `${day(pick.date)} · ${pick.start} – ${pick.end}`)),
        h('button', { type: 'button', class: 'bs-change', onclick: () => { open = false; draw(); host.querySelector('.bs-confirm')?.focus(); } }, 'Change')),
      field('Ministry or organisation', h('input', { name: 'org', type: 'text', maxlength: '160', value: details.org, oninput: keep('org') })),
      field('What is the event?', h('input', { name: 'purpose', type: 'text', maxlength: '300', value: details.purpose, oninput: keep('purpose') })),
      field('Expected attendance', h('input', { name: 'attendance', type: 'number', inputmode: 'numeric', min: '1', max: '99999', value: details.attendance, oninput: keep('attendance') })),
      field('Setup and AV needs (optional)', h('textarea', { name: 'setup', class: 'cr-area', maxlength: '1000', rows: '3', oninput: (e) => { details.setup = e.target.value; } }, details.setup)),
      alertBox(),
      h('button', { type: 'submit', id: 'bk-submit', class: 'cr-submit bs-go', disabled: busy || !ready() ? '' : null }, busy ? 'Sending…' : 'Send booking request'));
  }

  // Typing must not redraw the form (it would lose the cursor), so only the send button is updated.
  function refresh() {
    const b = host.querySelector('#bk-submit');
    if (b) b.toggleAttribute('disabled', busy || !ready());
  }

  function done() {
    const approved = result.status === 'Approved';
    return h('div', { class: 'bs-done', role: 'status', tabindex: '-1' },
      h('span', { class: 'done-ic', 'aria-hidden': 'true' }, ic('check', 22, 2.6)),
      h('span', { class: 'acct-what' },
        h('b', {}, approved ? 'Booked' : 'Request sent'),
        h('small', {}, `${result.facility} · ${day(result.date)} · ${result.start}–${result.end}`),
        h('small', {}, `Reference ${result.bookingId}. A confirmation is on its way to ${user()?.email ?? 'your email'}.`)));
  }

  function bookingCard(b, withRebook) {
    return h('article', { class: 'bs-card' },
      withRebook ? null : statusBadge(b.status),
      h('span', { class: 'acct-what' },
        h('b', {}, withRebook ? (b.purpose || b.facility) : b.facility),
        withRebook ? h('small', {}, b.facility) : null,
        h('small', {}, `${day(b.date)} · ${b.start}–${b.end}`),
        !withRebook && b.org ? h('small', {}, b.org) : null),
      withRebook ? h('button', { type: 'button', class: 'bs-rebook-btn', onclick: () => startRebook(b) }, ic('repeat', 16, 2.2), 'Rebook') : null);
  }

  function draw() {
    // Keep where each sideways strip was scrolled to across redraws.
    const scrolled = Object.fromEntries([...host.querySelectorAll('.bs-strip')].map((el) => [el.id, el.scrollLeft]));
    if (!cfg || !mine) {
      fill(host, head(), h('p', { class: 'note', role: 'status' }, error || 'Loading…'), error ? h('button', { type: 'button', class: 'btn', onclick: loadAll }, 'Try again') : null);
      return;
    }
    fill(host,
      head(),
      spaces(),
      h('section', { class: 'card bs-card-main', 'aria-label': 'Date and time' },
        dates(),
        timeline(),
        hours(),
        result ? done() : null,
        open ? detailsForm() : h('button', { type: 'button', class: 'cr-submit bs-go bs-confirm', disabled: timeOk() ? null : '', onclick: () => { open = true; error = ''; draw(); host.querySelector('[name="org"]')?.focus(); } }, 'Confirm'),
        !open ? alertBox() : null),
      h('section', { 'aria-labelledby': 'bs-mine-h', class: 'bs-list' },
        h('h2', { id: 'bs-mine-h', class: 'big-title' }, 'Your bookings'),
        mine.upcoming.length ? strip('bs-mine', 'Your bookings', mine.upcoming.map((b) => bookingCard(b, false))) : h('p', { class: 'note' }, 'No upcoming bookings.')),
      mine.past.length ? h('section', { 'aria-labelledby': 'bs-past-h', class: 'bs-list' },
        h('h2', { id: 'bs-past-h', class: 'big-title' }, 'Your earlier bookings'),
        strip('bs-past', 'Your earlier bookings', mine.past.map((b) => bookingCard(b, true)))) : null,
      h('div', { class: 'bk-signed' }, h('span', { class: 'muted' }, `Signed in as ${user()?.email ?? ''}`), h('button', { type: 'button', class: 'btn', onclick: signOut }, 'Sign out')));
    for (const [id, left] of Object.entries(scrolled)) { const el = host.querySelector(`#${id}`); if (el) el.scrollLeft = left; }
    const dayRow = host.querySelector('#bs-days');
    const chosen = host.querySelector(`.bs-day[data-date="${pick.date}"]`);
    if (dayRow && chosen && !(pick.date && scrolled['bs-days'] !== undefined && chosen.offsetLeft >= dayRow.scrollLeft && chosen.offsetLeft + chosen.offsetWidth <= dayRow.scrollLeft + dayRow.clientWidth)) {
      dayRow.scrollLeft = Math.max(0, chosen.offsetLeft - 24);
    }
  }

  draw();
  loadAll();
}

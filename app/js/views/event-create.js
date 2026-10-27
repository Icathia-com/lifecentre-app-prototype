// Create (or edit) an event, for admins and staff (design/Event-Create.dc.html).
// Also here, beyond the design: a registration link (what the Register button opens) and a "Pin to the top of Events" switch.
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { h, fill, dateKey, addDays, sgInputToMs, msToSgInput } from '../util.js';
import { TYPES, TYPE_IDS, SITES, SITE_IDS, MINISTRIES, COVERS, CHURCH, coverWords } from '../sites.js';
import { load, save, EVENT_DRAFT } from '../local.js';
import { ic, coverEl } from '../ui.js';
import { resizeToJpeg } from '../image.js';

const CAPACITIES = ['', '20', '50', '100', '200', '500'];

const blank = () => ({
  title: '', from: COVERS[0][0], to: COVERS[0][1], photo: '', date: addDays(dateKey(), 7), start: '19:30', endDate: addDays(dateKey(), 7), end: '21:00',
  loc: '', venue: '', type: 'special', desc: '', appr: false, paid: false, price: '', regUrl: '', vis: 'public', cap: '', pinned: false, notify: true,
});

// An existing event -> form values.
function fromEvent(ev) {
  const startLocal = msToSgInput(ev.start);
  const endLocal = msToSgInput(ev.end ?? ev.start + 2 * 3600000);
  return {
    ...blank(), title: ev.title, from: ev.cover?.from ?? COVERS[0][0], to: ev.cover?.to ?? COVERS[0][1], photo: ev.cover?.photo ?? '',
    date: startLocal.slice(0, 10), start: startLocal.slice(11), endDate: endLocal.slice(0, 10), end: endLocal.slice(11),
    loc: ev.location, venue: ev.place ?? '', type: ev.type, desc: ev.description ?? '', appr: !!ev.requireApproval, paid: !!ev.price, price: ev.price ? String(ev.price) : '',
    regUrl: ev.registerUrl ?? '', vis: ev.published ? 'public' : 'draft', cap: ev.capacity ? String(ev.capacity) : '', pinned: !!ev.pinned, notify: !!ev.notifyFollowers,
  };
}

// The host shown on the event: the ministry that runs that type of event, or the church.
const hostFor = (type) => MINISTRIES.find((m) => m.type === type)?.name ?? CHURCH.name;

export function render(root, params) {
  const editId = params.id ?? null;
  let s = blank();
  let existing = null;
  let session = null;
  let hasDraft = !editId && !!load(EVENT_DRAFT, null)?.title;
  let locOpen = false;
  let descOpen = false;
  let busy = false;
  let result = null; // { id, text } once saved
  let error = '';

  const host = h('div', { class: 'stack' });
  root.append(host);

  const keep = (patch) => {
    s = { ...s, ...patch };
    if (!editId) save(EVENT_DRAFT, s);
    draw();
  };

  const canSave = () => s.title.trim() && s.loc && s.date && s.start && !(sgInputToMs(`${s.endDate}T${s.end}`) < sgInputToMs(`${s.date}T${s.start}`));

  const sw = (label, on, onChange) => h('button', { type: 'button', role: 'switch', class: 'cr-switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onChange(!on) }, h('span', { class: 'knob' }));
  const row = (icn, label, control, extra) => h('div', { class: 'cr-row' }, ic(icn, 20), h('span', { class: 'cr-label' }, label), control, extra);
  const select = (label, value, options, onChange) => h('select', { class: 'cr-select', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));

  async function submit() {
    if (!canSave() || busy) return;
    busy = true;
    error = '';
    draw();
    try {
      const startMs = sgInputToMs(`${s.date}T${s.start}`);
      const endMs = sgInputToMs(`${s.endDate}T${s.end}`);
      const values = {
        title: s.title.trim(), start: startMs, end: endMs, location: s.loc, place: s.loc === 'other' ? (s.venue.trim() || 'Venue to be confirmed') : undefined, type: s.type,
        host: existing?.host ?? hostFor(s.type), description: s.desc.trim() || undefined,
        cover: { from: s.from, to: s.to, label: coverWords(s.title), ...(s.photo ? { photo: s.photo } : {}) },
        registerUrl: s.regUrl.trim() || undefined, requireApproval: s.appr, price: s.paid && Number(s.price) > 0 ? Math.round(Number(s.price)) : undefined,
        capacity: s.cap ? Number(s.cap) : undefined, notifyFollowers: s.notify, pinned: s.pinned, published: s.vis === 'public', createdAt: existing?.createdAt,
      };
      const id = await data.admin.save('events', session.email, values, editId ?? undefined);
      if (!editId) save(EVENT_DRAFT, null);
      result = { id, text: s.vis === 'draft' ? 'Saved as a draft. Only staff can see it.' : 'Everyone can see it in Events.' + (s.notify ? ' Followers are notified.' : '') };
    } catch (e) {
      error = e.code === 'permission-denied' ? 'This account is not allowed to do that.' : `Could not save: ${e.message}`;
    }
    busy = false;
    draw();
  }

  async function remove() {
    if (!existing || !confirm(`Delete "${existing.title}"?`)) return;
    try { await data.admin.remove('events', editId); location.hash = '#/events'; } catch (e) { error = `Could not delete: ${e.message}`; draw(); }
  }

  function draw() {
    const header = h('header', { class: 'cr-head' }, h('a', { class: 'round-btn', href: editId ? `#/events/${editId}` : '#/events', 'aria-label': editId ? 'Back to the event' : 'Back to Events' }, ic('back', 20, 2.2)),
      h('h1', { id: 'page-title', tabindex: '-1' }, result ? (editId ? 'Event updated' : 'Event created') : (editId ? 'Edit event' : 'Create event')));

    if (!['admin', 'staff'].includes(session?.role)) {
      host.replaceChildren(header, h('section', { class: 'card' },
        h('h2', { class: 'big' }, session?.role === 'leader' ? 'Leaders can’t create events' : 'Staff only'),
        h('p', { class: 'muted' }, session?.role === 'leader' ? 'Only admins and staff can create or change events.' : 'Admins and staff create events after signing in.'),
        session?.role === 'leader' ? null : h('a', { class: 'link', href: '#/staff' }, 'Staff sign-in')));
      return;
    }
    if (editId && !existing) { host.replaceChildren(header, h('p', { class: 'note', role: 'status' }, 'Loading…')); return; }

    if (result) {
      host.replaceChildren(header, h('section', { class: 'card done' },
        h('span', { class: 'done-ic', 'aria-hidden': 'true' }, ic('check', 28, 2.6)),
        h('h2', { class: 'big' }, s.title.trim()), h('p', { class: 'muted' }, result.text),
        h('a', { class: 'btn primary', href: `#/events/${result.id}` }, 'View event'),
        editId ? null : h('button', { type: 'button', class: 'btn', onclick: () => { s = blank(); result = null; hasDraft = false; draw(); } }, 'Create another')));
      return;
    }

    const preview = coverEl({ cover: { from: s.from, to: s.to, label: coverWords(s.title), photo: s.photo } }, { height: 270, radius: 26, fontSize: 30, width: '270px' });
    const photoInput = h('input', { type: 'file', accept: 'image/*', class: 'sr', onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try { keep({ photo: await resizeToJpeg(f) }); } catch (err) { error = err.message; draw(); }
    } });
    const coverBox = h('div', { class: 'cr-cover' }, preview,
      h('button', { type: 'button', class: 'cr-fab left', 'aria-label': 'Change cover colour', onclick: () => {
        const i = COVERS.findIndex(([a, b]) => a === s.from && b === s.to);
        const next = COVERS[(i + 1) % COVERS.length];
        keep({ from: next[0], to: next[1], photo: '' });
      } }, ic('palette', 20)),
      h('label', { class: 'cr-fab right', 'aria-label': 'Choose a cover photo' }, ic('image', 20), photoInput));

    const dateInput = (label, type, value, onChange) => h('input', { type, class: 'cr-input', 'aria-label': label, value, onchange: (e) => onChange(e.target.value) });
    const when = h('div', { class: 'card cr-card cr-when' },
      h('div', { class: 'timeline', 'aria-hidden': 'true' }, h('span', { class: 'tl-dot' }), h('span', { class: 'tl-line' }), h('span', { class: 'tl-ring' })),
      h('div', { class: 'cr-when-rows' },
        h('div', { class: 'cr-line' }, h('span', { class: 'cr-label' }, 'Start'), dateInput('Start date', 'date', s.date, (v) => keep({ date: v, endDate: s.endDate < v ? v : s.endDate })), dateInput('Start time', 'time', s.start, (v) => keep({ start: v }))),
        h('div', { class: 'cr-line top' }, h('span', { class: 'cr-label' }, 'End'), dateInput('End date', 'date', s.endDate, (v) => keep({ endDate: v })), dateInput('End time', 'time', s.end, (v) => keep({ end: v })))));

    const locLabel = s.loc ? (s.loc === 'other' ? (s.venue || 'Other venue') : SITES[s.loc].venue) : 'Choose location';
    const location = h('div', { class: 'card cr-card' },
      h('button', { type: 'button', class: 'cr-btn', 'aria-expanded': String(locOpen), onclick: () => { locOpen = !locOpen; draw(); } },
        ic('pin', 20), h('span', { class: `cr-label${s.loc ? '' : ' dim'}` }, locLabel), ic('right', 18)),
      locOpen ? h('div', { class: 'cr-chips', role: 'group', 'aria-label': 'Location' },
        [...SITE_IDS, 'other'].map((id) => h('button', { type: 'button', class: `chip${id === s.loc ? ' on' : ''}`, 'aria-pressed': String(id === s.loc), onclick: () => { s = { ...s, loc: id }; if (!editId) save(EVENT_DRAFT, s); locOpen = id === 'other'; draw(); } }, id === 'other' ? 'Other' : SITES[id].name))) : null,
      locOpen && s.loc === 'other' ? h('div', { class: 'cr-pad' }, h('input', { class: 'cr-input wide', 'aria-label': 'Venue', placeholder: 'Venue', value: s.venue, oninput: (e) => { s = { ...s, venue: e.target.value }; if (!editId) save(EVENT_DRAFT, s); } })) : null);

    const firstLine = s.desc.split('\n')[0];
    const desc = h('div', { class: 'card cr-card' },
      h('button', { type: 'button', class: 'cr-btn', 'aria-expanded': String(descOpen), onclick: () => { descOpen = !descOpen; draw(); } },
        ic('doc', 20), h('span', { class: `cr-label ellipsis${firstLine ? '' : ' dim'}` }, firstLine || 'Add description'), ic('right', 18)),
      descOpen ? h('div', { class: 'cr-pad' }, h('textarea', { class: 'cr-area', 'aria-label': 'Description', maxlength: '2000', oninput: (e) => { s = { ...s, desc: e.target.value }; if (!editId) save(EVENT_DRAFT, s); } }, s.desc)) : null);

    const ticketing = h('div', { class: 'card cr-card' },
      row('lock', 'Require approval', sw('Require approval', s.appr, (v) => keep({ appr: v }))),
      h('button', { type: 'button', class: 'cr-btn top', onclick: () => keep({ paid: !s.paid }) }, ic('dollar', 20), h('span', { class: 'cr-label' }, 'Price'), h('span', { class: 'cr-value' }, s.paid ? (s.price ? `S$${s.price}` : 'Paid') : 'Free'), ic('right', 18)),
      s.paid ? h('label', { class: 'cr-line top' }, h('span', { class: 'cr-label indent' }, 'Amount (S$)'), h('input', { type: 'number', min: '1', step: '1', class: 'cr-input', 'aria-label': 'Amount in Singapore dollars', value: s.price, onchange: (e) => keep({ price: e.target.value }) })) : null,
      h('label', { class: 'cr-line top' }, ic('link', 20), h('span', { class: 'cr-label nowrap' }, 'Registration link'), h('input', { type: 'url', class: 'cr-input url', 'aria-label': 'Registration link', placeholder: 'https://', value: s.regUrl, onchange: (e) => keep({ regUrl: e.target.value }) })));

    const options = h('div', { class: 'card cr-card' },
      h('label', { class: 'cr-line' }, ic('tag', 20), h('span', { class: 'cr-label' }, 'Type'), select('Type', s.type, TYPE_IDS.map((k) => [k, TYPES[k]]), (v) => keep({ type: v })), ic('updown', 16)),
      h('label', { class: 'cr-line top' }, ic('globe', 20), h('span', { class: 'cr-label' }, 'Visibility'), select('Visibility', s.vis, [['public', 'Public'], ['draft', 'Draft']], (v) => keep({ vis: v })), ic('updown', 16)),
      h('label', { class: 'cr-line top' }, ic('cap', 20), h('span', { class: 'cr-label' }, 'Capacity'), select('Capacity', s.cap, CAPACITIES.map((c) => [c, c || 'Unlimited']), (v) => keep({ cap: v })), ic('updown', 16)),
      row('bell', 'Notify followers', sw('Notify followers', s.notify, (v) => keep({ notify: v })), null),
      row('pin', 'Pin to the top of Events', sw('Pin to the top of Events', s.pinned, (v) => keep({ pinned: v }))));
    for (const r of options.querySelectorAll('.cr-row')) r.classList.add('top');

    fill(host, header,
      hasDraft && !s.title ? h('div', { class: 'cr-draft' },
        h('button', { type: 'button', onclick: () => { s = { ...blank(), ...load(EVENT_DRAFT, {}) }; hasDraft = false; draw(); } }, ic('doc', 16), 'Restore draft?'),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Dismiss draft', onclick: () => { save(EVENT_DRAFT, null); hasDraft = false; draw(); } }, ic('close', 14, 2.4))) : null,
      coverBox,
      h('input', { class: 'cr-name', 'aria-label': 'Event name', placeholder: 'Event name', maxlength: '120', value: s.title, oninput: (e) => { s = { ...s, title: e.target.value }; if (!editId) save(EVENT_DRAFT, s); const label = coverWords(s.title); preview.firstChild.textContent = label; submitBtn.disabled = !canSave(); } }),
      when, location, desc,
      h('div', { class: 'cr-section' }, 'Ticketing'), ticketing,
      h('div', { class: 'cr-section' }, 'Options'), options,
      error ? h('p', { class: 'error', role: 'alert' }, error) : null,
      (submitBtn = h('button', { type: 'button', class: 'cr-submit', disabled: !canSave() || busy ? '' : null, onclick: submit }, busy ? 'Saving…' : editId ? 'Save changes' : 'Create')),
      editId ? h('button', { type: 'button', class: 'btn danger', onclick: remove }, 'Delete event') : null);
  }
  let submitBtn;

  // Redraw only when who may use the form changes, so a late sign-in check never swallows a click or a keystroke.
  let first = true;
  const stop = onSession((next) => {
    const changed = first || next?.role !== session?.role;
    first = false;
    session = next;
    if (changed) draw();
  });

  if (editId) {
    data.getEvent(editId).then(({ value }) => {
      if (value) { existing = value; s = fromEvent(value); }
      else { existing = null; }
      draw();
    });
  }
  return stop;
}

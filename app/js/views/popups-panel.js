// The Pop-ups section of the staff page. Admins: the master switch, a form to make a pop-up (a banner cropped to the pop-up
// shape, a title, a linked event, start and end), and every pop-up with its status. Approvers (people with "Can approve
// pop-ups"): the pending requests, each with its banner, dates and requester, to approve or decline. Only one pop-up is
// live at a time: approving while another is live means choosing to replace it, or to keep it (which declines the new
// request with a note to the requester). Nobody approves their own request.
import { data } from '../firebase.js';
import { h, fill, formatDay, formatClock, minutesOfDay, msToSgInput, sgInputToMs } from '../util.js';
import { ic } from '../ui.js';
import { uploadFile, cropToBanner } from '../uploads.js';
import { safeImage } from '../popup.js';

export const STATUS = { draft: 'Draft', requested: 'Requested', approved: 'Scheduled', live: 'Live', ended: 'Ended', declined: 'Declined' };
const DAY = 86400000;
export const when = (ms) => `${formatDay(ms, { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatClock(minutesOfDay(ms))}`;
const span = (p) => `${when(p.start)} to ${when(p.end)}`;
const explain = (err) => (err.code === 'permission-denied' ? 'this account is not allowed to do that.' : err.message);

// The pop-up in the live slot (live now, or scheduled), if the list has it.
export const inSlot = (popups, config) => popups.find((p) => p.id === config.livePopupId && ['approved', 'live'].includes(p.status)) ?? null;

export function popupsPanel(user, entry) {
  const email = user.email.toLowerCase();
  const isAdmin = entry.role === 'admin';
  const status = h('p', { class: 'note', role: 'status', hidden: '' });
  const body = h('div', { class: 'stack' });
  let config = { popupsOn: false, livePopupId: null };
  let popups = [];
  let events = [];
  let form = null;    // the admin's form, when open
  let decline = null; // the id of the request a note is being written for
  let choice = null;  // { popup, live, mode } when making one live must replace the current one
  let busy = false;

  const say = (text, isError = false) => { status.hidden = !text; status.textContent = text; status.classList.toggle('error', isError); };
  const blank = () => ({ id: null, title: '', eventId: '', start: msToSgInput(Date.now()), end: msToSgInput(Date.now() + 7 * DAY), image: '', blob: null, preview: '', file: null, position: 0.5 });

  // Fresh data from the server: every decision here is taken on what is current, not on what was loaded earlier.
  async function loadData() {
    const [{ value: cfg }, list, evs] = await Promise.all([data.getAppConfig(), data.admin.listPopups(), isAdmin ? data.admin.list('events') : Promise.resolve([])]);
    config = cfg;
    popups = list;
    events = evs.filter((e) => e.published && (e.end ?? e.start) > Date.now()).sort((a, b) => a.start - b.start);
    await tidy();
  }
  async function refresh() {
    try { await loadData(); } catch (err) { say(`Could not load: ${explain(err)}`, true); }
    draw();
    section.removeAttribute('aria-busy'); // loaded: the section is drawn with its data
  }

  // The slot keeps itself right: a scheduled pop-up whose start has come is live; one whose end has passed is ended; a slot
  // pointing at a pop-up that is no longer live is cleared.
  async function tidy() {
    const slot = inSlot(popups, config);
    const now = Date.now();
    try {
      if (!slot) {
        if (config.livePopupId) { await data.admin.setSlot(email, null); config = { ...config, livePopupId: null }; }
        return;
      }
      if (slot.end <= now) {
        await data.admin.patch('popups', email, slot.id, { status: 'ended' });
        await data.admin.setSlot(email, null);
        slot.status = 'ended'; config = { ...config, livePopupId: null };
      } else if (slot.status === 'approved' && slot.start <= now) {
        await data.admin.patch('popups', email, slot.id, { status: 'live' });
        slot.status = 'live';
      }
    } catch (err) { console.warn('pop-up slot:', err.message); }
  }

  // One action at a time, on fresh data: the section is busy from the tap until it has been drawn again afterwards.
  async function act(label, fn) {
    if (busy) return;
    busy = true; section.setAttribute('aria-busy', 'true'); draw();
    try { await loadData(); await fn(); say(label); } catch (err) { say(`Could not do that: ${explain(err)}`, true); }
    busy = false;
    await refresh();
  }

  const over = (p) => p.end <= Date.now();

  // Puts a pop-up in the live slot, ending the one there. Scheduled when its start is still to come.
  async function activate(p) {
    const fresh = popups.find((x) => x.id === p.id) ?? p;
    if (over(fresh)) throw new Error('its end has passed. Change the dates first.');
    const slot = inSlot(popups, config);
    const now = Date.now();
    if (slot && slot.id !== fresh.id) await data.admin.patch('popups', email, slot.id, { status: 'ended' });
    await data.admin.patch('popups', email, fresh.id, { status: fresh.start > now ? 'approved' : 'live', approvedBy: email });
    await data.admin.setSlot(email, fresh.id);
    choice = null;
  }

  function goLive(p, mode) {
    if (over(p)) { say('Its end has passed. Change the dates first.', true); return; }
    const slot = inSlot(popups, config);
    if (slot && slot.id !== p.id) { choice = { popup: p, live: slot, mode }; decline = null; draw(); return; }
    act(mode === 'approve' ? 'Approved. It is now the live pop-up.' : 'It is now the live pop-up.', () => activate(p));
  }

  const keepCurrent = () => {
    const { popup, live } = choice;
    act('Declined. The current pop-up stays, and the requester has been told.', async () => {
      await data.admin.patch('popups', email, popup.id, { status: 'declined', approvedBy: email, note: `Another pop-up, "${live.title}", is live until ${when(live.end)}.` });
      choice = null;
    });
  };

  const declineWith = (p, note) => act('Declined, with your note to the requester.', async () => {
    await data.admin.patch('popups', email, p.id, { status: 'declined', approvedBy: email, note: note.trim() || 'Declined.' });
    decline = null;
  });

  const takeDown = (p) => act('Taken down. Nothing is showing now.', async () => {
    await data.admin.patch('popups', email, p.id, { status: 'ended' });
    if (config.livePopupId === p.id) await data.admin.setSlot(email, null);
  });

  const remove = (p) => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    act('Deleted.', async () => {
      await data.admin.remove('popups', p.id);
      if (config.livePopupId === p.id) await data.admin.setSlot(email, null);
      if (form?.id === p.id) form = null;
    });
  };

  const toggleSwitch = () => act(config.popupsOn ? 'Pop-ups are off. Nothing shows to members.' : 'Pop-ups are on. Members see the live pop-up once a day.',
    () => data.admin.setConfig(email, { popupsOn: !config.popupsOn, livePopupId: config.livePopupId }));

  // ---- The admin's form ----

  async function pick(file) {
    if (!file) return;
    form.file = file;
    await recrop();
  }
  async function recrop() {
    try {
      form.blob = await cropToBanner(form.file, { position: form.position });
      if (form.preview) URL.revokeObjectURL(form.preview);
      form.preview = URL.createObjectURL(form.blob);
      say('');
    } catch (err) { form.blob = null; say(err.message, true); }
    draw();
  }

  function saveForm(makeLive) {
    const start = form.start ? sgInputToMs(form.start) : NaN;
    const end = form.end ? sgInputToMs(form.end) : NaN;
    if (!form.title.trim()) return say('Give the pop-up a title.', true);
    if (!form.blob && !form.image) return say('Choose a banner first.', true);
    if (!(start < end)) return say('The end must be after the start.', true);
    if (makeLive && end <= Date.now()) return say('Its end has passed. Change the dates first.', true);
    act(makeLive ? 'Saved. It is now the live pop-up.' : 'Saved as a draft.', async () => {
      const image = form.blob ? await uploadFile(form.blob, { kind: 'popups' }) : form.image;
      const slot = inSlot(popups, config);
      const liveStatus = start > Date.now() ? 'approved' : 'live';
      const values = {
        title: form.title.trim(), image, eventId: form.eventId || undefined, start, end, status: makeLive ? liveStatus : (form.status ?? 'draft'),
        requestedBy: form.requestedBy ?? email, approvedBy: makeLive ? email : form.approvedBy, note: form.note, createdAt: form.createdAt,
      };
      if (makeLive && values.status !== 'draft' && form.status === 'requested' && form.requestedBy === email) throw new Error('you cannot approve your own request.');
      const id = await data.admin.save('popups', email, values, form.id ?? undefined);
      if (makeLive) {
        if (slot && slot.id !== id) await data.admin.patch('popups', email, slot.id, { status: 'ended' });
        await data.admin.setSlot(email, id);
      }
      form = null;
    });
  }

  const edit = (p) => { form = { ...blank(), id: p.id, title: p.title, eventId: p.eventId ?? '', start: msToSgInput(p.start), end: msToSgInput(p.end), image: p.image, preview: safeImage(p.image), status: p.status, requestedBy: p.requestedBy, approvedBy: p.approvedBy, note: p.note, createdAt: p.createdAt }; choice = null; say(''); draw(); body.querySelector('#pu-title')?.focus(); };

  function formCard() {
    const fileInput = h('input', { type: 'file', id: 'pu-file', accept: 'image/*', class: 'sr', onchange: (e) => pick(e.target.files?.[0]) });
    const preview = form.preview
      ? h('img', { class: 'pu-preview', src: form.preview, alt: 'Banner preview, cropped to the pop-up shape' })
      : h('div', { class: 'pu-preview empty', role: 'img', 'aria-label': 'No banner yet' }, 'No banner yet');
    return h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); saveForm(false); } },
      h('h2', {}, form.id ? 'Edit pop-up' : 'New pop-up'),
      h('div', { class: 'pu-form-img' }, preview,
        h('div', { class: 'pu-img-tools' },
          h('label', { class: 'btn', for: 'pu-file' }, ic('image', 16, 2), form.preview ? 'Change banner' : 'Choose banner'), fileInput,
          h('p', { class: 'muted' }, 'Cropped to the pop-up shape (4 by 5) and made smaller on this phone before it is uploaded.'),
          form.file ? h('label', { class: 'pu-pos' }, 'Position the crop',
            h('input', { type: 'range', id: 'pu-pos', min: '0', max: '100', value: String(Math.round(form.position * 100)), onchange: (e) => { form.position = Number(e.target.value) / 100; recrop(); } })) : null)),
      h('div', { class: 'field' }, h('label', { for: 'pu-title' }, 'Title'), h('input', { type: 'text', id: 'pu-title', maxlength: '80', required: '', value: form.title, oninput: (e) => { form.title = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'pu-event' }, 'Link to an event (optional)'),
        h('select', { id: 'pu-event', onchange: (e) => { form.eventId = e.target.value; const ev = events.find((x) => x.id === form.eventId); if (ev?.end) { form.end = msToSgInput(ev.end); body.querySelector('#pu-end').value = form.end; } } },
          h('option', { value: '', selected: !form.eventId }, 'No link'),
          events.map((ev) => h('option', { value: ev.id, selected: ev.id === form.eventId }, `${ev.title} · ${formatDay(ev.start)}`)))),
      h('div', { class: 'pu-when' },
        h('div', { class: 'field' }, h('label', { for: 'pu-start' }, 'Show from'), h('input', { type: 'datetime-local', id: 'pu-start', value: form.start, onchange: (e) => { form.start = e.target.value; } })),
        h('div', { class: 'field' }, h('label', { for: 'pu-end' }, 'Until'), h('input', { type: 'datetime-local', id: 'pu-end', value: form.end, onchange: (e) => { form.end = e.target.value; } }))),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn', disabled: busy ? '' : null }, 'Save as draft'),
        h('button', { type: 'button', class: 'btn primary', disabled: busy ? '' : null, onclick: () => saveForm(true) }, busy ? 'Working…' : 'Make live'),
        h('button', { type: 'button', class: 'btn', onclick: () => { form = null; say(''); draw(); } }, 'Cancel')));
  }

  // ---- Rows ----

  const thumb = (p) => h('img', { class: 'pu-thumb', src: safeImage(p.image), alt: '' });
  const badge = (p) => h('span', { class: `pu-status ${p.status}` }, STATUS[p.status] ?? p.status);

  function requestRow(p) {
    const own = p.requestedBy === email;
    const acts = h('div', { class: 'pu-acts' },
      h('button', { type: 'button', class: 'btn primary', disabled: busy || own || over(p) ? '' : null, 'aria-label': `Approve ${p.title}`, onclick: () => goLive(p, 'approve') }, 'Approve'),
      h('button', { type: 'button', class: 'btn', disabled: busy || own ? '' : null, 'aria-label': `Decline ${p.title}`, onclick: () => { decline = p.id; choice = null; draw(); body.querySelector('#pu-note')?.focus(); } }, 'Decline'));
    return h('li', { class: 'pu-row' }, thumb(p),
      h('div', { class: 'pu-text' }, h('b', {}, p.title), h('span', { class: 'meta' }, span(p)), h('span', { class: 'meta' }, `From ${p.requestedBy}`),
        own ? h('span', { class: 'note' }, 'Your own request: someone else approves it.') : null,
        over(p) ? h('span', { class: 'note' }, 'Its end has passed: it can only be declined, or the requester changes the dates.') : null,
        acts,
        decline === p.id ? declineBox(p) : null,
        choice?.popup.id === p.id ? choiceBox() : null));
  }

  function declineBox(p) {
    const note = h('textarea', { id: 'pu-note', maxlength: '300', rows: '3', 'aria-label': 'Note to the requester', placeholder: 'Why not, or what to change' });
    return h('div', { class: 'pu-decline' },
      h('label', { for: 'pu-note', class: 'muted' }, 'A note to the requester'), note,
      h('div', { class: 'pu-acts' },
        h('button', { type: 'button', class: 'btn danger', onclick: () => declineWith(p, note.value) }, 'Decline with this note'),
        h('button', { type: 'button', class: 'btn', onclick: () => { decline = null; draw(); } }, 'Cancel')));
  }

  function choiceBox() {
    const { popup, live, mode } = choice;
    return h('div', { class: 'pu-choice', role: 'group', 'aria-label': 'Another pop-up is live' },
      h('span', {}, h('b', {}, live.title), ` is ${live.status === 'live' ? 'live' : 'scheduled'} until ${when(live.end)}. Only one pop-up can be live.`),
      h('button', { type: 'button', class: 'btn primary', onclick: () => act(mode === 'approve' ? 'Approved. It replaced the pop-up that was live.' : 'It replaced the pop-up that was live.', () => activate(popup)) }, 'Replace the current pop-up'),
      mode === 'approve'
        ? h('button', { type: 'button', class: 'btn', onclick: keepCurrent }, 'Keep the current one')
        : h('button', { type: 'button', class: 'btn', onclick: () => { choice = null; draw(); } }, 'Cancel'));
  }

  function slotCard(slot) {
    return h('div', { class: 'card', 'aria-label': 'Live pop-up' },
      h('h3', { class: 'label' }, slot.status === 'live' ? 'Live now' : 'Scheduled'),
      h('div', { class: 'pu-row' }, thumb(slot),
        h('div', { class: 'pu-text' }, h('b', {}, slot.title), h('span', { class: 'meta' }, span(slot)),
          h('span', { class: 'meta' }, `Requested by ${slot.requestedBy}${slot.approvedBy ? `, approved by ${slot.approvedBy}` : ''}`),
          h('div', { class: 'pu-acts' }, h('button', { type: 'button', class: 'btn danger', disabled: busy ? '' : null, onclick: () => takeDown(slot) }, 'Take down')))));
  }

  function otherRow(p) {
    const acts = [
      ['draft', 'approved', 'ended', 'declined', 'requested'].includes(p.status) ? h('button', { type: 'button', class: 'btn', disabled: busy || (p.status === 'requested' && p.requestedBy === email) ? '' : null, 'aria-label': `Make ${p.title} live`, onclick: () => goLive(p, 'live') }, 'Make live') : null,
      h('button', { type: 'button', class: 'btn', 'aria-label': `Edit ${p.title}`, onclick: () => edit(p) }, 'Edit'),
      h('button', { type: 'button', class: 'btn danger', 'aria-label': `Delete ${p.title}`, onclick: () => remove(p) }, 'Delete'),
    ];
    return h('li', { class: 'pu-row' }, thumb(p),
      h('div', { class: 'pu-text' }, h('b', {}, p.title), badge(p), h('span', { class: 'meta' }, span(p)),
        h('span', { class: 'meta' }, `Requested by ${p.requestedBy}${p.approvedBy ? ` · decided by ${p.approvedBy}` : ''}`),
        p.note ? h('span', { class: 'meta' }, `Note: ${p.note}`) : null,
        h('div', { class: 'pu-acts' }, acts),
        choice?.popup.id === p.id ? choiceBox() : null));
  }

  function draw() {
    const slot = inSlot(popups, config);
    const requests = popups.filter((p) => p.status === 'requested');
    const others = popups.filter((p) => p.status !== 'requested' && p.id !== slot?.id);
    fill(body,
      h('div', { class: 'pu-head' }, h('h2', {}, 'Pop-ups'),
        isAdmin ? h('div', { class: 'cr-row' }, h('span', { class: 'cr-label' }, 'Show to members'),
          h('button', { type: 'button', role: 'switch', class: 'cr-switch', 'aria-checked': String(config.popupsOn), 'aria-label': 'Show pop-ups to members', disabled: busy ? '' : null, onclick: toggleSwitch }, h('span', { class: 'knob' }))) : null),
      h('p', { class: 'pu-state' }, config.popupsOn ? 'On: members see the live pop-up once a day, on their first open of the day.' : 'Off: nothing shows to members until an admin turns this on.'),
      slot ? slotCard(slot) : h('p', { class: 'muted' }, 'No pop-up is live.'),
      isAdmin ? (form ? formCard() : h('button', { type: 'button', class: 'btn primary', onclick: () => { form = blank(); choice = null; say(''); draw(); body.querySelector('#pu-title')?.focus(); } }, 'New pop-up')) : null,
      h('h3', { class: 'label' }, 'Requests'),
      requests.length ? h('ul', { class: 'pu-list' }, requests.map(requestRow)) : h('p', { class: 'muted' }, 'No requests waiting.'),
      isAdmin ? [h('h3', { class: 'label' }, 'All pop-ups'), others.length ? h('ul', { class: 'pu-list' }, others.map(otherRow)) : h('p', { class: 'muted' }, 'Nothing else yet.')] : null);
  }

  const section = h('section', { class: 'card panel pu-panel', 'aria-label': 'Pop-ups', 'aria-busy': 'true' }, status, body);
  draw();
  refresh();
  return section;
}

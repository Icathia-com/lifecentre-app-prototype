// Staff page: Google sign-in, then add, edit or delete church notices and scheduled verses, and manage events.
// Events are created and edited in the app itself (#/events/new); this page lists them so they can be found and deleted.
// Admins can also manage the staff list. The security rules decide what each account may do.
import { data, getAuthTools } from '../firebase.js';
import { h, dateKey, addDays, formatDay, msToSgInput, sgInputToMs } from '../util.js';
import { TYPES, siteName } from '../sites.js';
import { BOOKS, buildPassage, parsePassageId, parseReference } from '../bible.js';

// Admins and staff post content; leaders are on the staff list but cannot (the security rules enforce this too).
const POSTERS = ['admin', 'staff'];

// What each section needs: its form fields, a blank item, and how to describe an item in the list.
const PANELS = {
  announcements: {
    label: 'Notices', noun: 'notice', roles: POSTERS, // church notices appear in Notifications
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, max: 120 },
      { name: 'body', label: 'Message', type: 'textarea', max: 4000 },
      { name: 'publishedAt', label: 'Date shown (Singapore time)', type: 'datetime', required: true },
      { name: 'linkUrl', label: 'Link (https://)', type: 'url', max: 500, pattern: 'https://.+' },
      { name: 'linkLabel', label: 'Link label', type: 'text', max: 40 },
      { name: 'published', label: 'Published (visible to everyone)', type: 'checkbox' },
    ],
    blank: () => ({ publishedAt: Date.now(), pinned: false, published: true }),
    show: (a) => [a.title, [formatDay(a.publishedAt), !a.published && 'Draft']],
  },
  verses: {
    label: 'Verses', noun: 'verse', idField: 'date', roles: POSTERS,
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, lockWhenEditing: true },
      { name: 'book', label: 'Book', type: 'select', required: true, options: BOOKS.map((b) => ({ value: b.code, label: b.name })) },
      { name: 'chapter', label: 'Chapter', type: 'whole', required: true, max: 3 },
      { name: 'verseFrom', label: 'Verse from', type: 'whole', required: true, max: 3 },
      { name: 'verseTo', label: 'Verse to (optional)', type: 'whole', max: 3 },
    ],
    blank: () => ({ date: addDays(dateKey(), 1), book: 'GEN' }),
    // A saved verse is a passage; one saved before Bible versions has only its typed reference, which is read back where it can be.
    fromItem: (v) => {
      const p = parsePassageId(v.passageId) ?? parsePassageId(parseReference(v.reference)?.passageId);
      return { date: v.id, ...(p ? { book: p.code, chapter: p.chapter, verseFrom: p.from, verseTo: p.to ?? undefined } : { book: 'GEN' }) };
    },
    // The form's choices become the saved passage (or a message). The text for each Bible version comes from the daily job.
    prepare: (v) => {
      const built = buildPassage(v.book, v.chapter, v.verseFrom, v.verseTo);
      return built.ok ? { values: { date: v.date, passageId: built.passageId, reference: built.reference } } : { error: built.error };
    },
    show: (v) => [`${dateLabel(v.id)} · ${v.reference}`, []],
  },
  events: {
    label: 'Events', noun: 'event', roles: POSTERS, external: true, // created and edited in the app (#/events/new)
    fields: [],
    blank: () => ({}),
    show: (e) => [e.title, [formatDay(e.start), siteName(e.location, e.place), TYPES[e.type], !e.published && 'Draft']],
  },
  staff: {
    label: 'Staff', noun: 'staff member', idField: 'email', roles: ['admin'],
    fields: [
      { name: 'email', label: 'Google account email', type: 'email', required: true, max: 120, lockWhenEditing: true },
      { name: 'name', label: 'Name', type: 'text', max: 80 },
      { name: 'role', label: 'Role', type: 'select', options: ['staff', 'leader', 'admin'] },
    ],
    blank: () => ({ role: 'staff' }),
    fromItem: (s) => ({ ...s, email: s.id }),
    show: (s) => [s.name || s.id, [s.name && s.id, s.role]],
  },
};

// '2026-11-01' -> 'Sun 1 Nov 2026'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const explain = (err) => (err.code === 'permission-denied' ? 'this account is not allowed to do that.' : err.message);

function fieldEl(f, value, id, editing) {
  if (f.type === 'checkbox') {
    return h('div', { class: 'field check' }, h('input', { type: 'checkbox', id, name: f.name, checked: !!value }), h('label', { for: id }, f.label));
  }
  const common = { id, name: f.name, required: f.required, maxlength: f.max };
  let input;
  if (f.type === 'textarea') input = h('textarea', { ...common, rows: 5 }, value ?? '');
  else if (f.type === 'select') {
    input = h('select', common, f.options.map((o) => {
      const [v, label] = typeof o === 'string' ? [o, o] : [o.value, o.label];
      return h('option', { value: v, selected: v === value }, label);
    }));
  }
  else {
    input = h('input', {
      ...common, type: f.type === 'datetime' ? 'datetime-local' : f.type === 'whole' ? 'text' : f.type, pattern: f.type === 'whole' ? '[0-9]*' : f.pattern,
      inputmode: f.type === 'whole' ? 'numeric' : undefined, autocomplete: f.type === 'whole' ? 'off' : undefined,
      value: f.type === 'datetime' ? (value ? msToSgInput(value) : '') : (value ?? ''),
      readonly: f.lockWhenEditing && editing,
    });
  }
  return h('div', { class: 'field' }, h('label', { for: id }, f.label), input);
}

function readValues(form, fields) {
  const values = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (f.type === 'checkbox') values[f.name] = el.checked;
    else if (f.type === 'datetime') values[f.name] = el.value ? sgInputToMs(el.value) : undefined;
    else values[f.name] = el.value.trim() || undefined;
  }
  return values;
}

function panel(col, spec, user) {
  const status = h('p', { class: 'note', role: 'status', hidden: '' });
  const formBox = h('div');
  const list = h('ul', { class: 'items' });
  let items = [];
  let editing = null; // the item being edited, or null for a new one

  const say = (text, isError = false) => {
    status.hidden = !text;
    status.textContent = text;
    status.classList.toggle('error', isError);
  };

  function drawForm() {
    if (spec.external) { formBox.replaceChildren(h('a', { class: 'btn primary', href: '#/events/new' }, 'Create event')); return; }
    const start = editing ? (spec.fromItem ? spec.fromItem(editing) : editing) : spec.blank();
    const form = h('form', { class: 'form' },
      h('h2', {}, editing ? `Edit ${spec.noun}` : `New ${spec.noun}`),
      spec.fields.map((f) => fieldEl(f, start[f.name], `${col}-${f.name}`, !!editing)),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        editing ? h('button', { class: 'btn', type: 'button', onclick: () => { editing = null; say(''); drawForm(); } }, 'Cancel') : null));
    form.addEventListener('submit', onSubmit);
    formBox.replaceChildren(form);
  }

  async function onSubmit(e) {
    e.preventDefault();
    let values = readValues(e.currentTarget, spec.fields);
    if (values.end && values.end < values.start) return say('The end must be after the start.', true);
    if (spec.prepare) {
      const prepared = spec.prepare(values);
      if (prepared.error) return say(prepared.error, true);
      values = prepared.values;
    }
    const id = spec.idField ? String(values[spec.idField]).toLowerCase() : editing?.id;
    try {
      await data.admin.save(col, user.email, values, id);
      editing = null;
      drawForm();
      await refresh();
      say('Saved.');
    } catch (err) {
      say(`Could not save: ${explain(err)}`, true);
    }
  }

  async function remove(item, title) {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await data.admin.remove(col, item.id);
      if (editing?.id === item.id) { editing = null; drawForm(); }
      await refresh();
      say('Deleted.');
    } catch (err) {
      say(`Could not delete: ${explain(err)}`, true);
    }
  }

  function drawList() {
    list.replaceChildren(...items.map((item) => {
      const [title, meta] = spec.show(item);
      const isSelf = col === 'staff' && item.id === user.email.toLowerCase();
      return h('li', { class: 'item' },
        h('div', {},
          h('span', { class: 'name' }, title), ' ', item.sample ? h('span', { class: 'badge' }, 'Sample') : null,
          h('span', { class: 'meta' }, meta.filter(Boolean).join(' · '))),
        h('div', { class: 'actions' },
          spec.external
            ? h('a', { class: 'btn', href: `#/events/${encodeURIComponent(item.id)}/edit`, 'aria-label': `Edit ${title}` }, 'Edit')
            : h('button', {
              type: 'button', class: 'btn', 'aria-label': `Edit ${title}`,
              onclick: () => { editing = item; say(''); drawForm(); formBox.querySelector('input:not([readonly]),textarea,select')?.focus(); },
            }, 'Edit'),
          h('button', { type: 'button', class: 'btn danger', 'aria-label': `Delete ${title}`, disabled: isSelf, onclick: () => remove(item, title) }, 'Delete')));
    }));
  }

  async function refresh() {
    try {
      items = await data.admin.list(col);
      drawList();
    } catch (err) {
      say(`Could not load: ${explain(err)}`, true);
    }
  }

  drawForm();
  refresh();
  return h('section', { class: 'card panel', 'aria-label': spec.label }, status, formBox, list);
}

export async function render(root) {
  const body = h('div', { class: 'stack' });
  root.append(
    h('header', { class: 'screen-head' },
      h('h1', { id: 'page-title', tabindex: '-1' }, 'Staff'),
      h('a', { class: 'back', href: '#/' }, '‹ Back to the app')),
    body);

  const tools = await getAuthTools();
  let ticket = 0;

  function signedOut() {
    const error = h('p', { class: 'error', role: 'alert', hidden: '' });
    return h('section', { class: 'card', 'aria-labelledby': 'signin-h' },
      h('h2', { id: 'signin-h', class: 'label' }, 'Staff sign-in'),
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: async () => {
          try { await tools.signInWithGoogle(); } catch (err) {
            if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) return;
            error.hidden = false;
            error.textContent = `Could not sign in: ${err.message}`;
          }
        },
      }, 'Sign in with Google'),
      error);
  }

  const signOutButton = () => h('button', { type: 'button', class: 'btn', onclick: () => tools.signOut(tools.auth) }, 'Sign out');

  function notStaff(user) {
    return h('section', { class: 'card' }, h('p', { class: 'who' }, `${user.email} is not on the staff list.`), signOutButton());
  }

  function dashboard(user, entry) {
    const names = Object.keys(PANELS).filter((k) => PANELS[k].roles.includes(entry.role));
    if (!names.length) {
      return h('section', { class: 'card' },
        h('p', { class: 'who' }, h('span', {}, 'Signed in as ', h('strong', {}, user.email), ` (${entry.role})`), signOutButton()),
        h('p', { class: 'note' }, `Your role (${entry.role}) can't post notices, verses or events.`));
    }
    let current = names[0];
    const switcher = h('div', { class: 'switch', role: 'group', 'aria-label': 'Sections' });
    const holder = h('div', { class: 'stack' });
    function draw() {
      switcher.replaceChildren(...names.map((n) => h('button', {
        type: 'button', class: 'btn', 'aria-pressed': String(n === current), onclick: () => { current = n; draw(); },
      }, PANELS[n].label)));
      holder.replaceChildren(panel(current, PANELS[current], user));
    }
    draw();
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('p', { class: 'who' }, h('span', {}, 'Signed in as ', h('strong', {}, user.email), ` (${entry.role})`), signOutButton())),
      switcher,
      holder);
  }

  async function show(user) {
    const mine = ++ticket;
    if (!user) { body.replaceChildren(signedOut()); return; }
    body.replaceChildren(h('p', { class: 'note', role: 'status' }, 'Checking your account…'));
    let entry = null;
    try { entry = await data.admin.getStaffEntry(user.email); } catch (err) { console.warn(err); }
    if (mine === ticket) body.replaceChildren(entry ? dashboard(user, entry) : notStaff(user));
  }

  return tools.onAuthStateChanged(tools.auth, show);
}

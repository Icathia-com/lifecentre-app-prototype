// The verse of the day on Home: the text in the chosen Bible version, its reference, the licence notice and publisher link,
// and a chip that opens a search sheet to change the version. The choice is saved on the phone (lc:v1:bible-version); no sign-in.
// When the day's text, or the chosen version, is missing, the app's own KJV verse is shown and labelled KJV.
import { h, enableDragScroll } from './util.js';
import { ic } from './ui.js';
import { cardFor, languageById, savedRecent, savedVersion, saveRecent, saveVersion, searchVersions } from './bible.js';

const sampleBadge = (item) => (item.sample ? h('span', { class: 'badge' }, 'Sample') : null);

// A passage can run to 25 verses, so longer text is set smaller to keep the card readable.
const sizeClass = (text) => (text.length > 420 ? 'xlong' : text.length > 140 ? 'long' : null);

// The language tag of a version's text, for screen readers and fonts.
const LANG_TAGS = { eng: 'en', tam: 'ta', tel: 'te', mal: 'ml', tha: 'th', zho: 'zh' };
function langOf(card) {
  if (card.fallback) return undefined;
  return card.id === 1392 ? 'zh-Hant' : card.id === 36 ? 'zh-Hans' : LANG_TAGS[card.language];
}

// builtIn: the app's KJV verse { reference, text, sample? }. votd: the day's document, or null.
export function createVerseCard({ builtIn, votd }) {
  const host = h('section', { class: 'soft', 'aria-labelledby': 'verse-h' });
  let chosen = savedVersion();

  function draw() {
    const card = cardFor(votd, builtIn, chosen);
    const wide = !!languageById(card.language)?.wide; // Tamil, Telugu, Malayalam and Thai are set smaller
    const chip = h('button', {
      type: 'button', class: 'verse-chip', 'aria-haspopup': 'dialog',
      'aria-label': `Bible version: ${card.abbr}. Change version`,
      onclick: () => openVersionSheet({
        current: card.id, opener: chip,
        onPick: (id) => { chosen = id; saveVersion(id); saveRecent(id); draw(); host.querySelector('.verse-chip')?.focus(); },
      }),
    }, h('span', { class: 'chip' }, card.abbr, ic('down', 11, 2.4)));
    host.replaceChildren(h('div', { class: 'verse-card' },
      h('div', { class: 'verse-top' }, h('h2', { id: 'verse-h' }, 'Verse of the day'), chip),
      h('blockquote', { lang: langOf(card), class: [sizeClass(card.text), wide ? 'wide-script' : null].filter(Boolean).join(' ') || null }, card.text),
      h('cite', {}, card.reference),
      card.footnotes.length ? h('ol', { class: 'verse-notes', 'aria-label': 'Footnotes' }, card.footnotes.map((n) => h('li', {}, n))) : null,
      card.notice || card.link
        ? h('p', { class: 'verse-notice' }, card.notice, card.notice && card.link ? ' ' : null,
          card.link ? h('a', { href: card.link.href, target: '_blank', rel: 'noopener' }, card.link.label) : null)
        : null,
      card.fallback ? sampleBadge(builtIn) : null));
  }

  draw();
  return host;
}

// A small bottom sheet: a search box and a few versions. Before anything is typed it shows three (the recent ones, or the usual three);
// typing shows up to six matches. Picking one calls onPick(id) and closes the sheet.
export function openVersionSheet({ current, opener, onPick }) {
  const wrap = h('div', { class: 'sheet-wrap version-sheet' });
  const close = () => { wrap.remove(); try { opener?.focus?.({ preventScroll: true }); } catch { /* the opener may be gone */ } };
  const recent = savedRecent();
  let found = [];

  const status = h('p', { class: 'sr', role: 'status', 'aria-live': 'polite' });
  const empty = h('p', { class: 'vs-empty', hidden: '' }, 'No versions found');
  const list = h('ul', { class: 'vs-list', id: 'vs-results', 'aria-label': 'Bible versions' });
  const scroller = h('div', { class: 'vs-scroll' }, list, empty);
  enableDragScroll(scroller);
  const pick = (v) => { close(); onPick(v.id); };
  const input = h('input', {
    type: 'search', id: 'vs-search', class: 'vs-search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': 'Search Bible versions', 'aria-controls': 'vs-results', placeholder: 'Search Bible versions',
    oninput: () => draw(),
    onkeydown: (e) => { if (e.key === 'Enter' && found.length) { e.preventDefault(); pick(found[0]); } },
  });

  function draw() {
    found = searchVersions(input.value, recent);
    list.replaceChildren(...found.map((v) => h('li', {},
      h('button', { type: 'button', class: 'vs-item', 'data-version': String(v.id), 'aria-current': v.id === current ? 'true' : null, onclick: () => pick(v) },
        h('span', { class: 'vs-text' }, h('b', {}, v.abbr), h('small', {}, `${v.name} · ${languageById(v.language).label}`)),
        v.id === current ? h('span', { class: 'vs-check' }, ic('check', 18, 2.4), h('span', { class: 'sr' }, 'Current version')) : null))));
    empty.hidden = found.length > 0;
    list.hidden = found.length === 0;
    status.textContent = found.length ? `${found.length} ${found.length === 1 ? 'version' : 'versions'}` : 'No versions found';
  }

  const dialog = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vs-title' },
    h('div', { class: 'sheet-top' },
      h('h2', { id: 'vs-title' }, 'Bible version'),
      h('button', { type: 'button', class: 'round-btn sheet-x', 'aria-label': 'Close', onclick: close }, ic('close', 18, 2.2))),
    input, scroller, status);

  wrap.append(h('button', { type: 'button', class: 'sheet-back', 'aria-label': 'Close', tabindex: '-1', onclick: close }), dialog);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    // Arrow keys move through the results; Down from the search box goes to the first, Up from the first goes back to the box.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...list.querySelectorAll('.vs-item')];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') items[Math.min(at + 1, items.length - 1)].focus();
      else if (at <= 0) input.focus();
      else items[at - 1].focus();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, input')].filter((el) => !el.hidden && !el.closest('[hidden]') && el.tabIndex >= 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  draw();
  document.querySelector('.app').append(wrap);
  input.focus();
  return close;
}

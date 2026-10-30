// The verse of the day on Home: the text in the chosen Bible version, its reference, the licence notice and publisher link,
// and a chip that opens a sheet to change the version. The choice is saved on the phone (lc:v1:bible-version); no sign-in.
// When the day's text, or the chosen version, is missing, the app's own KJV verse is shown and labelled KJV.
import { h, enableDragScroll } from './util.js';
import { ic } from './ui.js';
import { cardFor, savedVersion, saveVersion, versionById, versionGroups } from './bible.js';

const sampleBadge = (item) => (item.sample ? h('span', { class: 'badge' }, 'Sample') : null);

// builtIn: the app's KJV verse { reference, text, sample? }. votd: the day's document, or null.
export function createVerseCard({ builtIn, votd }) {
  const host = h('section', { class: 'soft', 'aria-labelledby': 'verse-h' });
  let chosen = savedVersion();

  function draw() {
    const card = cardFor(votd, builtIn, chosen);
    const chip = h('button', {
      type: 'button', class: 'verse-chip', 'aria-haspopup': 'dialog',
      'aria-label': `Bible version: ${card.abbr}. Change version`,
      onclick: () => openVersionSheet({ votd, current: card.id, opener: chip, onPick: (id) => { chosen = id; saveVersion(id); draw(); host.querySelector('.verse-chip')?.focus(); } }),
    }, h('span', { class: 'chip' }, card.abbr, ic('down', 11, 2.4)));
    host.replaceChildren(h('div', { class: 'verse-card' },
      h('div', { class: 'verse-top' }, h('h2', { id: 'verse-h' }, 'Verse of the day'), chip),
      h('blockquote', { lang: card.fallback ? undefined : langOf(card), class: sizeClass(card.text) }, card.text),
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

// A passage can run to 25 verses, so longer text is set smaller to keep the card readable.
const sizeClass = (text) => (text.length > 420 ? 'xlong' : text.length > 140 ? 'long' : undefined);

// The language tag of a version's text, for screen readers and fonts.
const LANG_TAGS = { eng: 'en', tam: 'ta', tel: 'te', mal: 'ml', tha: 'th', zho: 'zh' };
function langOf(card) {
  const v = versionById(card.id);
  if (!v) return undefined;
  return v.id === 1392 ? 'zh-Hant' : v.id === 36 ? 'zh-Hans' : LANG_TAGS[v.language];
}

// A bottom sheet listing every version, grouped by language. Picking one calls onPick(id) and closes the sheet.
export function openVersionSheet({ votd, current, opener, onPick }) {
  const wrap = h('div', { class: 'sheet-wrap version-sheet' });
  const close = () => { wrap.remove(); try { opener?.focus?.({ preventScroll: true }); } catch { /* the opener may be gone */ } };

  const groups = versionGroups(votd);
  const list = h('div', { class: 'vs-list', tabindex: '0', role: 'region', 'aria-label': 'Bible versions' },
    groups.map((g, i) => h('section', { class: 'vs-group', 'aria-labelledby': `vs-h-${g.id}` },
      h('h3', { id: `vs-h-${g.id}` }, g.label),
      h('ul', {}, g.versions.map((v) => h('li', {},
        h('button', {
          type: 'button', class: 'vs-item', 'data-version': String(v.id), 'aria-current': v.id === current ? 'true' : null,
          onclick: () => { close(); onPick(v.id); },
        },
        h('span', { class: 'vs-text' }, h('b', {}, v.abbr), h('small', {}, v.name)),
        v.id === current ? h('span', { class: 'vs-check' }, ic('check', 18, 2.4), h('span', { class: 'sr' }, 'Current version')) : null)))))));
  enableDragScroll(list);

  const dialog = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vs-title' },
    h('div', { class: 'sheet-top' },
      h('h2', { id: 'vs-title' }, 'Bible version'),
      h('button', { type: 'button', class: 'round-btn sheet-x', 'aria-label': 'Close', onclick: close }, ic('close', 18, 2.2))),
    list);

  wrap.append(h('button', { type: 'button', class: 'sheet-back', 'aria-label': 'Close', tabindex: '-1', onclick: close }), dialog);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, [tabindex="0"]')].filter((el) => el.tabIndex >= 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.querySelector('.app').append(wrap);
  (list.querySelector('[aria-current]') ?? list.querySelector('.vs-item')).focus();
  return close;
}

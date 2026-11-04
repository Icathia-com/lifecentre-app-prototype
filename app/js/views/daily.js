// The daily verse flow, full screen, opened from the verse card on Home. Step 1: the verse in the member's version, large,
// with its reference, version chip, licence notice and link, and "Read the full chapter" where that version allows it.
// Step 2: today's stories in the stories viewer, or else the written devotion (skipped when there is neither). Step 3: the
// streak. Swipe up (or the arrow, or the Down key) for the next step, down for the one before.
// Counting is on the phone only: opening step 1 counts a verse read, reaching step 3 a devotion done and a day of the streak.
import { h, fill, dateKey, formatDay } from '../util.js';
import { ic } from '../ui.js';
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { load, save } from '../local.js';
import { cardFor, languageById, linkFor, noticeFor, savedVersion, saveRecent, saveVersion, versionById } from '../bible.js';
import { openVersionSheet } from '../verse-card.js';
import { DAILY_KEY, chapterAllowed, dailyStats, dayVerses, flowSteps, markDone, markRead } from '../daily.js';
import { groupByAuthor } from '../stories.js';
import { openStories } from './story-viewer.js';
import { avatarEl } from './story-row.js';

const SWIPE = 60;
const LANG_TAGS = { eng: 'en', tam: 'ta', tel: 'te', mal: 'ml', tha: 'th', zho: 'zh' };
const langOf = (card) => (card.fallback ? undefined : card.id === 1392 ? 'zh-Hant' : card.id === 36 ? 'zh-Hans' : LANG_TAGS[card.language]);
const sizeClass = (text) => (text.length > 420 ? 'xlong' : text.length > 200 ? 'long' : null);

// A flame of our own drawing.
const FLAME = '<svg aria-hidden="true" viewBox="0 0 64 80" width="100%" height="100%"><defs><linearGradient id="dv-fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF5A1F"/><stop offset="0.55" stop-color="#FF9A2E"/><stop offset="1" stop-color="#FFD25E"/></linearGradient></defs><path fill="url(#dv-fl)" d="M33 2c3 12 18 20 20 38 2 17-9 34-21 36C18 78 7 66 8 50c1-12 9-18 12-27 2 7 1 12 6 16 2-15 4-25 7-37z"/><path fill="#FFE9A8" d="M32 40c2 7 10 11 10 21 0 8-5 13-10 13s-10-4-10-11c0-8 7-11 10-23z"/></svg>';
const flame = (cls) => { const t = document.createElement('template'); t.innerHTML = FLAME; const el = t.content.firstElementChild; el.setAttribute('class', cls); return el; };

export function render(root) {
  const today = dateKey();
  save(DAILY_KEY, markRead(load(DAILY_KEY, {}), today)); // step 1 opened: a verse read today

  let builtIn = null;
  let votd = null;
  let groups = [];
  let devotion = null;
  let bibleConfig = { biblicaChapters: false };
  let chosen = savedVersion();
  let chapter = null;        // the chapter document for the chosen version, when there is one and it may be shown
  let steps = ['verse', 'streak'];
  let at = 0;
  let me = null;
  let closeStories = null;
  let closeSheet = null;
  let alive = true;

  const panel = h('div', { class: 'dv-panel' });
  const next = h('button', { type: 'button', class: 'dv-next', 'aria-label': 'Next', onclick: () => go(at + 1) }, ic('down', 26, 2.4));
  const host = h('div', { class: 'dv own-drag', 'data-step': 'verse' },
    h('div', { class: 'dv-top' },
      h('a', { class: 'dv-icon', href: '#/', 'aria-label': 'Close' }, ic('close', 20, 2.4)),
      h('span', { class: 'dv-date' }, formatDay(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }))),
    panel, next);
  root.append(host);
  const stopSession = onSession((s) => { me = s?.email ? { email: s.email, canPost: !!s.postStories, name: s.displayName || s.name || s.email, photo: s.photo || '' } : null; });

  // ---- Step 1: the verse ----
  function verseStep() {
    if (!builtIn) return [h('h1', { id: 'page-title', class: 'dv-kicker', tabindex: '-1' }, 'Verse of the day'), h('p', { class: 'dv-wait', role: 'status' }, 'Loading…')];
    const card = cardFor(votd, builtIn, chosen);
    const wide = !!languageById(card.language)?.wide;
    const chip = h('button', {
      type: 'button', class: 'dv-chip', 'aria-haspopup': 'dialog', 'aria-label': `Bible version: ${card.abbr}. Change version`,
      onclick: () => { closeSheet = openVersionSheet({ current: card.id, opener: chip, onPick: (id) => { chosen = id; saveVersion(id); saveRecent(id); loadChapter(); draw(); host.querySelector('.dv-chip')?.focus(); } }); },
    }, card.abbr, ic('down', 12, 2.6));
    return [
      h('h1', { id: 'page-title', class: 'dv-kicker', tabindex: '-1' }, 'Verse of the day'),
      h('div', { class: 'dv-verse' },
        h('blockquote', { lang: langOf(card), class: [sizeClass(card.text), wide ? 'wide-script' : null].filter(Boolean).join(' ') || null }, card.text),
        h('div', { class: 'dv-ref' }, h('cite', {}, card.reference), chip),
        card.notice || card.link
          ? h('p', { class: 'dv-notice' }, card.notice, card.notice && card.link ? ' ' : null, card.link ? h('a', { href: card.link.href, target: '_blank', rel: 'noopener' }, card.link.label) : null)
          : null,
        chapter ? h('button', { type: 'button', class: 'dv-btn', onclick: openChapter }, ic('book', 18, 2), 'Read the full chapter') : null),
    ];
  }

  // ---- Step 2: today's stories, or the written devotion ----
  function storiesStep() {
    const watch = () => {
      closeStories?.();
      closeStories = openStories({ groups, startIndex: 0, me, host, onClose: () => { closeStories = null; host.querySelector('.dv-watch')?.focus(); } });
    };
    return [
      h('h1', { id: 'page-title', class: 'dv-kicker', tabindex: '-1' }, 'Today’s stories'),
      h('div', { class: 'dv-people' }, groups.map((g) => h('span', { class: 'dv-person' }, avatarEl(g, 64), h('span', {}, g.name)))),
      h('button', { type: 'button', class: 'dv-btn dv-watch', onclick: watch }, ic('play', 18, 2), 'Watch'),
    ];
  }
  function devotionStep() {
    const d = devotion;
    return [
      h('h1', { id: 'page-title', class: 'dv-kicker', tabindex: '-1' }, 'Today’s devotion'),
      h('article', { class: 'dv-devotion' },
        h('h2', {}, d.title),
        h('p', { class: 'dv-dref' }, ic('book', 16, 2), d.reference),
        String(d.body).split(/\n\s*\n/).map((para) => h('p', { class: 'dv-body' }, para.trim())),
        h('section', { class: 'dv-prayer', 'aria-labelledby': 'dv-prayer-h' }, h('h3', { id: 'dv-prayer-h' }, 'Prayer'), h('p', {}, d.prayer))),
    ];
  }

  // ---- Step 3: the streak ----
  function streakStep() {
    const stats = dailyStats(load(DAILY_KEY, {}), today);
    return [
      h('h1', { id: 'page-title', class: 'dv-kicker', tabindex: '-1' }, 'Your streak'),
      h('div', { class: 'dv-streak' },
        h('div', { class: 'dv-flame' }, flame('dv-flame-svg'), h('b', { class: 'dv-count' }, String(stats.streak))),
        h('p', { class: 'dv-days' }, stats.streak === 1 ? 'day in a row' : 'days in a row'),
        h('ol', { class: 'dv-week', 'aria-label': 'The last 7 days' }, stats.week.map((d) => h('li', { class: d.done ? 'done' : null },
          h('span', { class: 'dv-dot', 'aria-hidden': 'true' }, d.done ? ic('check', 14, 3) : null),
          h('span', { class: 'dv-wd', 'aria-hidden': 'true' }, formatDay(Date.parse(`${d.day}T12:00:00+08:00`), { weekday: 'narrow' })),
          h('span', { class: 'sr' }, `${formatDay(Date.parse(`${d.day}T12:00:00+08:00`), { weekday: 'long' })}: ${d.done ? 'done' : 'not done'}`))))),
      h('a', { class: 'dv-btn dv-done', href: '#/' }, 'Done'),
    ];
  }

  function draw() {
    const step = steps[at];
    host.dataset.step = step;
    next.hidden = at >= steps.length - 1;
    fill(panel, step === 'verse' ? verseStep() : step === 'stories' ? storiesStep() : step === 'devotion' ? devotionStep() : streakStep());
    panel.scrollTop = 0;
  }

  function go(i) {
    if (i < 0 || i >= steps.length || i === at) return;
    closeStories?.();
    const forward = i > at;
    at = i;
    if (steps[at] === 'streak') save(DAILY_KEY, markDone(load(DAILY_KEY, {}), today)); // step 3 reached: a devotion done today
    panel.classList.remove('in-up', 'in-down');
    void panel.offsetWidth;
    panel.classList.add(forward ? 'in-up' : 'in-down');
    draw();
    host.querySelector('#page-title')?.focus({ preventScroll: true });
    if (steps[at] === 'stories') host.querySelector('.dv-watch')?.click();
  }

  // ---- The full chapter ----
  async function loadChapter() {
    chapter = null;
    const version = versionById(chosen);
    const card = builtIn ? cardFor(votd, builtIn, chosen) : null;
    if (!card || card.fallback || !chapterAllowed(version, bibleConfig)) return;
    const { value } = await data.getChapter(today, chosen);
    const wanted = dayVerses(votd?.passageId);
    if (!alive || chosen !== version.id || !value || !wanted || value.chapterId !== wanted.chapter) return;
    if (!(value.verses?.length || value.text)) return;
    chapter = value;
    if (steps[at] === 'verse') draw();
  }

  function openChapter() {
    const version = versionById(chosen);
    const range = dayVerses(votd?.passageId);
    const entry = votd?.versions?.[String(chosen)];
    const notice = noticeFor(version, chapter);
    const link = linkFor(version, chapter);
    let body;
    if (chapter.verses?.length) {
      body = h('div', { class: 'dv-ch-text', lang: langOf({ id: version.id, language: version.language }) }, chapter.verses.map((v) => {
        const on = range && v.n >= range.from && v.n <= range.to;
        return h(on ? 'mark' : 'span', { class: `dv-v${on ? ' on' : ''}`, 'data-verse': String(v.n) }, h('sup', {}, String(v.n)), `${v.text} `);
      }));
    } else {
      // The chapter came without verse marks: the day's verses are found in it by their text.
      const text = String(chapter.text);
      const day = String(entry?.text ?? '').trim();
      const k = day ? text.indexOf(day) : -1;
      body = h('div', { class: 'dv-ch-text plain', lang: langOf({ id: version.id, language: version.language }) },
        k < 0 ? text : [text.slice(0, k), h('mark', { class: 'dv-v on' }, day), text.slice(k + day.length)]);
    }
    const close = () => { layer.remove(); host.querySelector('.dv-btn')?.focus(); };
    const layer = h('div', { class: 'dv-chapter', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dv-ch-h' },
      h('div', { class: 'dv-ch-head' },
        h('button', { type: 'button', class: 'dv-icon', 'aria-label': 'Close chapter', onclick: close }, ic('back', 20, 2.4)),
        h('h2', { id: 'dv-ch-h' }, chapter.reference || '', h('span', { class: 'dv-ch-abbr' }, chapter.abbr || version.abbr))),
      h('div', { class: 'dv-ch-scroll' }, body,
        notice || link ? h('p', { class: 'dv-ch-notice' }, notice, notice && link ? ' ' : null, link ? h('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.label) : null) : null));
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    host.append(layer);
    layer.querySelector('.dv-icon').focus();
    layer.querySelector('.dv-v.on')?.scrollIntoView({ block: 'center' });
  }

  // ---- Gestures and keys ----
  let press = null;
  const scrolledToEnd = (el) => el.scrollHeight - el.clientHeight - el.scrollTop < 4;
  host.addEventListener('pointerdown', (e) => {
    if (closeStories || e.target.closest('.dv-chapter, .sheet-wrap, a, button, input')) { press = null; return; }
    press = { x: e.clientX, y: e.clientY, top: panel.scrollTop, end: scrolledToEnd(panel) };
  });
  host.addEventListener('pointerup', (e) => {
    if (!press) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    const p = press;
    press = null;
    if (Math.abs(dy) < SWIPE || Math.abs(dx) > Math.abs(dy)) return;
    // A long devotion scrolls first: only a swipe at its end (or its top, going back) changes the step.
    if (dy < 0 && p.end && scrolledToEnd(panel)) go(at + 1);
    else if (dy > 0 && p.top <= 0) go(at - 1);
  });
  host.addEventListener('pointercancel', () => { press = null; });
  const onKey = (e) => {
    if (closeStories || host.querySelector('.dv-chapter') || document.querySelector('.version-sheet')) return;
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { if (scrolledToEnd(panel)) { e.preventDefault(); go(at + 1); } }
    else if ((e.key === 'ArrowUp' || e.key === 'PageUp') && panel.scrollTop <= 0) { e.preventDefault(); go(at - 1); }
  };
  document.addEventListener('keydown', onKey);

  draw();
  Promise.all([data.getVerse(today), data.getVotd(today), data.getStories(), data.getDevotion(today), data.getBibleConfig()])
    .then(([verse, day, stories, dev, config]) => {
      if (!alive) return;
      builtIn = verse.value;
      votd = day.value;
      groups = groupByAuthor(stories.value);
      devotion = dev.value;
      bibleConfig = config.value;
      steps = flowSteps({ storyCount: groups.length, devotion });
      draw();
      return loadChapter();
    });

  return () => {
    alive = false;
    closeStories?.();
    closeSheet?.();
    stopSession();
    document.removeEventListener('keydown', onKey);
  };
}

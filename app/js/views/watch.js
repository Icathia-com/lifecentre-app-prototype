// Watch: a full-screen feed of short videos. Swipe or drag up for the next one, tap to pause, sound on/off, a thin
// progress line, and "Continue where you left off" when the member comes back. Layout follows design/Watch.dc.html.
// Until real videos are published (the publisher screen is a later step), the feed is the design's sample videos:
// colour cards with no picture or sound behind them, labelled "Sample". The progress line runs over each sample's length.
import { h, fill, icon } from '../util.js';
import { ic } from '../ui.js';
import { load, save, WATCH_RESUME, WATCH_SOUND } from '../local.js';
import { sampleVideos } from '../sample-data.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const DRAG_PX = 70; // how far a mouse drag must go to change video

export function render(root) {
  const videos = sampleVideos();
  let idx = 0;
  let t = 0;
  let playing = true;
  let sound = load(WATCH_SOUND, false) === true;
  let moved = false;
  let drag = null;
  const timers = [];

  const saved = load(WATCH_RESUME, null);
  const back = saved ? videos.findIndex((v) => v.id === saved.id) : -1;
  let resumeText = '';
  if (back >= 0) {
    idx = back;
    t = Math.min(Math.max(0, Math.trunc(saved.t) || 0), videos[back].dur - 1);
    if (t > 2) resumeText = `Continue where you left off · ${fmt(t)}`;
  }

  const slides = videos.map((v) => h('div', { class: 'wt-slide', style: `--a:${v.c[0]};--b:${v.c[1]}` }, h('span', { class: 'wt-mono', 'aria-hidden': 'true' }, 'LC')));
  const feed = h('div', { class: 'wt-feed own-drag', tabindex: '0', role: 'group', 'aria-label': 'Videos' }, slides);
  const pause = h('div', { class: 'wt-pause', 'aria-hidden': 'true' }, icon('<svg width="34" height="34" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg>'));
  const toast = h('div', { class: 'wt-toast', role: 'status' });
  const announce = h('p', { class: 'sr', role: 'status' });
  const avatar = h('span', { class: 'wt-av' }, 'LC');
  const title = h('div', { class: 'wt-title' });
  const desc = h('div', { class: 'wt-desc' });
  const barFill = h('div', { class: 'wt-bar-fill' });
  const bar = h('div', { class: 'wt-bar', role: 'progressbar', 'aria-label': 'Video progress', 'aria-valuemin': '0' }, barFill);
  const soundBtn = h('button', { type: 'button', class: 'wt-sound', onclick: () => { sound = !sound; save(WATCH_SOUND, sound); paintSound(); } });

  const cur = () => videos[idx];
  const height = () => feed.clientHeight || 1;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function paintBar() {
    const v = cur();
    barFill.style.width = `${Math.min(100, (t / v.dur) * 100)}%`;
    bar.setAttribute('aria-valuemax', String(v.dur));
    bar.setAttribute('aria-valuenow', String(t));
    bar.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(v.dur)}`);
  }
  function paintSound() {
    soundBtn.setAttribute('aria-label', sound ? 'Mute' : 'Turn sound on');
    soundBtn.replaceChildren(ic(sound ? 'sound' : 'mute', 22, 2));
  }
  function paintToast() {
    toast.textContent = resumeText || ' ';
    toast.classList.toggle('on', Boolean(resumeText));
  }
  function paint() {
    const v = cur();
    avatar.style.background = `linear-gradient(135deg, ${v.c[0]}, ${v.c[1]})`;
    title.textContent = v.title;
    desc.textContent = v.desc;
    pause.classList.toggle('on', !playing);
    paintBar();
  }
  const keep = () => save(WATCH_RESUME, { id: cur().id, t });

  function goto(i) {
    const next = Math.max(0, Math.min(videos.length - 1, i));
    feed.scrollTo({ top: next * height(), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function toggle() { playing = !playing; paint(); }

  feed.addEventListener('scroll', () => {
    const i = Math.max(0, Math.min(videos.length - 1, Math.round(feed.scrollTop / height())));
    if (i === idx) return;
    idx = i; t = 0; playing = true; resumeText = '';
    paintToast(); paint(); keep();
    announce.textContent = `Video ${idx + 1} of ${videos.length}: ${cur().title}`;
  });

  // Touch and trackpad scroll the feed natively; a mouse drag is handled here, ending on a whole video.
  feed.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { y: e.clientY, last: e.clientY, top: feed.scrollTop, from: Math.round(feed.scrollTop / height()), id: e.pointerId };
    moved = false;
  });
  feed.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!moved && Math.abs(dy) > 5) { moved = true; feed.setPointerCapture(drag.id); feed.style.scrollSnapType = 'none'; }
    if (moved) { drag.last = e.clientY; feed.scrollTop = drag.top - dy; }
  });
  const release = () => {
    if (!drag) return;
    const d = drag.last - drag.y;
    const from = drag.from;
    drag = null;
    if (!moved) return;
    feed.style.scrollSnapType = '';
    goto(from + (d < -DRAG_PX ? 1 : d > DRAG_PX ? -1 : 0));
  };
  feed.addEventListener('pointerup', release);
  feed.addEventListener('pointercancel', release);
  feed.addEventListener('click', () => { if (moved) { moved = false; return; } toggle(); });

  feed.addEventListener('keydown', (e) => {
    const go = { ArrowDown: idx + 1, PageDown: idx + 1, ArrowUp: idx - 1, PageUp: idx - 1, Home: 0, End: videos.length - 1 }[e.key];
    if (go !== undefined) { e.preventDefault(); goto(go); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });

  timers.push(setInterval(() => {
    if (!playing || document.hidden) return;
    t += 1;
    if (t >= cur().dur) t = 0;
    keep();
    paintBar();
  }, 1000));

  fill(root,
    h('div', { class: 'wt' },
      h('h1', { id: 'page-title', class: 'sr', tabindex: '-1' }, 'Watch'),
      feed, pause,
      h('div', { class: 'wt-shade top', 'aria-hidden': 'true' }), h('div', { class: 'wt-shade bottom', 'aria-hidden': 'true' }),
      toast,
      h('div', { class: 'wt-side' }, soundBtn),
      h('div', { class: 'wt-info' },
        h('div', { class: 'wt-who' }, avatar, h('span', { class: 'wt-name' }, 'Life Centre'), h('span', { class: 'wt-chip' }, 'Sample')),
        title, desc),
      bar,
      h('div', { class: 'wt-caption' }, 'Sample videos'),
      announce));

  paintSound(); paintToast(); paint();
  // Jump to the video the member left off at, once the feed has a height (twice, in case the layout settles late).
  if (idx > 0) for (const ms of [30, 400]) timers.push(setTimeout(() => feed.scrollTo({ top: idx * height(), behavior: 'auto' }), ms));
  if (resumeText) timers.push(setTimeout(() => { resumeText = ''; paintToast(); }, 3600));

  return () => { for (const id of timers) { clearInterval(id); clearTimeout(id); } };
}

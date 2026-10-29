// Watch: a full-screen feed of short videos, newest first. Swipe or drag up for the next one, tap to pause, sound on/off,
// a thin progress line, and "Continue where you left off" when the member comes back. Layout follows design/Watch.dc.html.
// Videos are YouTube links posted by admins and leaders (the + button, design/Watch-Publisher.dc.html) and play in YouTube's
// own player, driven through its iframe API. While nothing is posted the feed shows the design's sample colour cards.
import { h, fill, icon } from '../util.js';
import { ic } from '../ui.js';
import { load, save, WATCH_RESUME, WATCH_SOUND } from '../local.js';
import { sampleVideos } from '../sample-data.js';
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { parseYouTube, thumbnailUrl, loadYouTubeApi } from '../youtube.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const DRAG_PX = 70; // how far a mouse drag must go to change video
const PALETTE = [['#5B2A86', '#1B1740'], ['#C2185B', '#4A148C'], ['#00796B', '#0D2B3E'], ['#E65100', '#4E1B00'], ['#1565C0', '#0B1F3A'], ['#6A1B9A', '#1A237E']];
const colours = (id) => PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

export function render(root) {
  let videos = [];
  let idx = 0;
  let t = 0;
  let playing = true;
  let sound = load(WATCH_SOUND, false) === true;
  let moved = false;
  let drag = null;
  let canPost = false;
  let isStaff = false;
  let sheet = null; // { error, busy } while the Add a video sheet is open
  let wasPlaying = true;
  let player = null; // YouTube's player for the video on screen
  let playerFor = null;
  let seekTo = 0;
  let resumeText = '';
  let alive = true;
  const timers = [];

  const feed = h('div', { class: 'wt-feed own-drag', tabindex: '0', role: 'group', 'aria-label': 'Videos' });
  const pause = h('div', { class: 'wt-pause', 'aria-hidden': 'true' }, icon('<svg width="34" height="34" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg>'));
  const toast = h('div', { class: 'wt-toast', role: 'status' });
  const announce = h('p', { class: 'sr', role: 'status' });
  const avatar = h('span', { class: 'wt-av' }, 'LC');
  const name = h('span', { class: 'wt-name' });
  const chip = h('span', { class: 'wt-chip' });
  const title = h('div', { class: 'wt-title' });
  const desc = h('div', { class: 'wt-desc' });
  const caption = h('div', { class: 'wt-caption' });
  const barFill = h('div', { class: 'wt-bar-fill' });
  const bar = h('div', { class: 'wt-bar', role: 'progressbar', 'aria-label': 'Video progress', 'aria-valuemin': '0' }, barFill);
  const soundBtn = h('button', { type: 'button', class: 'wt-sound', onclick: () => { sound = !sound; save(WATCH_SOUND, sound); applySound(); paintSound(); } });
  const addBtn = h('button', { type: 'button', class: 'wt-top-btn wt-add', 'aria-label': 'Add a video', onclick: () => openSheet() }, ic('plus', 22, 2.4));
  const removeBtn = h('button', { type: 'button', class: 'wt-top-btn wt-remove', 'aria-label': 'Remove this video', onclick: () => removeCurrent() }, ic('trash', 20, 2));
  const topBar = h('div', { class: 'wt-top' }, removeBtn, addBtn);
  const sheetHost = h('div');

  const cur = () => videos[idx];
  const height = () => feed.clientHeight || 1;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isYouTube = (v) => v?.src === 'youtube';

  function paintBar() {
    const v = cur();
    if (!v) return;
    const dur = v.dur || 0;
    barFill.style.width = dur ? `${Math.min(100, (t / dur) * 100)}%` : '0%';
    bar.setAttribute('aria-valuemax', String(Math.max(dur, t, 1)));
    bar.setAttribute('aria-valuenow', String(t));
    bar.setAttribute('aria-valuetext', dur ? `${fmt(t)} of ${fmt(dur)}` : fmt(t));
  }
  function paintSound() {
    soundBtn.setAttribute('aria-label', sound ? 'Mute' : 'Turn sound on');
    soundBtn.replaceChildren(ic(sound ? 'sound' : 'mute', 22, 2));
  }
  function paintToast() {
    toast.textContent = resumeText || ' ';
    toast.classList.toggle('on', Boolean(resumeText));
  }
  function paintTop() {
    addBtn.hidden = !canPost;
    removeBtn.hidden = !isStaff || !cur() || Boolean(cur().sample);
    topBar.hidden = addBtn.hidden && removeBtn.hidden;
  }
  function paint() {
    const v = cur();
    if (!v) return;
    const [a, b] = v.c ?? colours(v.id);
    avatar.style.background = `linear-gradient(135deg, ${a}, ${b})`;
    name.textContent = v.org || 'Life Centre';
    chip.textContent = v.sample ? 'Sample' : 'YouTube';
    title.textContent = v.title;
    desc.textContent = v.desc || '';
    desc.hidden = !v.desc;
    caption.textContent = v.sample ? 'Sample videos' : '';
    pause.classList.toggle('on', !playing);
    paintBar();
    paintTop();
  }
  const keep = () => { if (cur()) save(WATCH_RESUME, { id: cur().id, t }); };

  // YouTube's player, mounted on the slide on screen only, with its own controls hidden: taps and drags reach the feed.
  function unmountPlayer() {
    try { player?.destroy?.(); } catch { /* already gone */ }
    player = null; playerFor = null;
    for (const gone of feed.querySelectorAll('.wt-yt, .wt-fail')) gone.remove();
  }
  function applySound() {
    try { if (sound) player?.unMute?.(); else player?.mute?.(); } catch { /* not ready yet */ }
  }
  function applyPlaying() {
    try { if (playing) player?.playVideo?.(); else player?.pauseVideo?.(); } catch { /* not ready yet */ }
  }
  function failSlide(slide, v) {
    slide.append(h('div', { class: 'wt-fail' }, h('p', {}, 'This video could not be loaded.'),
      h('a', { class: 'wt-fail-link', href: v.url, target: '_blank', rel: 'noopener' }, 'Open on YouTube')));
  }
  function mountPlayer() {
    const v = cur();
    if (!v || !isYouTube(v) || playerFor === v.id) return;
    unmountPlayer();
    const slide = feed.children[idx];
    if (!slide) return;
    playerFor = v.id;
    const mount = h('div', { class: 'wt-yt' });
    slide.append(mount);
    loadYouTubeApi().then((YT) => {
      if (!alive || playerFor !== v.id) return;
      player = new YT.Player(mount, {
        videoId: v.videoId, host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1, fs: 0, iv_load_policy: 3, mute: sound ? 0 : 1, origin: location.origin },
        events: {
          onReady: () => {
            if (!alive || playerFor !== v.id) return;
            if (seekTo > 0) { player.seekTo(seekTo, true); seekTo = 0; }
            applySound(); applyPlaying();
          },
          onStateChange: (e) => { if (e.data === 0 && alive && playerFor === v.id) { player.seekTo(0, true); applyPlaying(); } },
          onError: () => { if (alive && playerFor === v.id) failSlide(slide, v); },
        },
      });
    }).catch(() => { if (alive && playerFor === v.id) { mount.remove(); failSlide(slide, v); } });
  }

  function goto(i) {
    const next = Math.max(0, Math.min(videos.length - 1, i));
    feed.scrollTo({ top: next * height(), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function toggle() { playing = !playing; applyPlaying(); paint(); }

  feed.addEventListener('scroll', () => {
    const i = Math.max(0, Math.min(videos.length - 1, Math.round(feed.scrollTop / height())));
    if (i === idx || !videos.length) return;
    idx = i; t = 0; playing = true; resumeText = ''; seekTo = 0;
    paintToast(); paint(); keep(); mountPlayer();
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
    const v = cur();
    if (!v || !playing || document.hidden || sheet) return;
    if (isYouTube(v)) {
      if (typeof player?.getCurrentTime !== 'function') return;
      t = Math.floor(player.getCurrentTime() || 0);
      const length = Math.floor(player.getDuration?.() || 0);
      if (length) v.dur = length;
    } else {
      t += 1;
      if (t >= v.dur) t = 0;
    }
    keep();
    paintBar();
  }, 1000));

  // The feed itself: posted videos, or the samples while there are none.
  function showVideos(list, { jumpTo = null, resume = false } = {}) {
    unmountPlayer();
    videos = list.length ? list : sampleVideos();
    idx = 0; t = 0; playing = true; seekTo = 0; resumeText = '';
    if (resume) {
      const saved = load(WATCH_RESUME, null);
      const back = saved ? videos.findIndex((v) => v.id === saved.id) : -1;
      if (back >= 0) {
        idx = back;
        const v = videos[back];
        t = Math.max(0, Math.trunc(saved.t) || 0);
        if (!isYouTube(v)) t = Math.min(t, v.dur - 1);
        if (isYouTube(v)) seekTo = t;
        if (t > 2) resumeText = `Continue where you left off · ${fmt(t)}`;
      }
    }
    if (jumpTo !== null) idx = Math.max(0, Math.min(videos.length - 1, jumpTo));
    fill(feed, videos.map((v) => {
      const [a, b] = v.c ?? colours(v.id);
      const slide = h('div', { class: 'wt-slide', style: `--a:${a};--b:${b}` }, h('span', { class: 'wt-mono', 'aria-hidden': 'true' }, 'LC'));
      if (isYouTube(v)) slide.append(h('img', { class: 'wt-thumb', src: thumbnailUrl(v.videoId), alt: '', 'aria-hidden': 'true', onerror: (e) => e.target.remove() }));
      return slide;
    }));
    paintToast(); paint(); mountPlayer();
    announce.textContent = '';
    // Jump to the video wanted, once the feed has a height (twice, in case the layout settles late).
    if (idx > 0) for (const ms of [30, 400]) timers.push(setTimeout(() => { if (alive) feed.scrollTo({ top: idx * height(), behavior: 'auto' }); }, ms));
    else feed.scrollTo({ top: 0, behavior: 'auto' });
    if (resumeText) timers.push(setTimeout(() => { resumeText = ''; paintToast(); }, 3600));
  }

  async function reload(options) {
    const { value } = await data.getVideos();
    if (alive) showVideos(value, options);
  }

  // Add a video (admins and leaders): a title and a YouTube link.
  function closeSheet() {
    sheet = null; sheetHost.replaceChildren();
    if (wasPlaying) { playing = true; applyPlaying(); paint(); }
    addBtn.focus();
  }
  function openSheet() {
    wasPlaying = playing; playing = false; applyPlaying(); paint();
    sheet = { error: '', busy: false };
    const titleInput = h('input', { id: 'wt-f-title', maxlength: '120', placeholder: 'What is the video about?', autocomplete: 'off' });
    const linkInput = h('input', { id: 'wt-f-link', type: 'text', inputmode: 'url', placeholder: 'Paste a YouTube or YouTube Shorts link', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const error = h('div', { class: 'wt-error', role: 'alert' });
    const post = h('button', { type: 'button', class: 'wt-publish' }, 'Publish');
    const fail = (message) => { error.textContent = message; sheet.busy = false; post.disabled = false; post.textContent = 'Publish'; };
    async function publish() {
      if (sheet.busy) return;
      const text = titleInput.value.trim();
      const link = parseYouTube(linkInput.value);
      if (!text) { fail('Please give the video a title.'); titleInput.focus(); return; }
      if (!link) { fail('Please paste a YouTube or YouTube Shorts link.'); linkInput.focus(); return; }
      sheet.busy = true; post.disabled = true; post.textContent = 'Publishing…'; error.textContent = '';
      try {
        const email = (await session()).email;
        const entry = await data.admin.getStaffEntry(email);
        const org = (entry?.name || '').trim().slice(0, 40);
        await data.admin.save('videos', email, { title: text, src: 'youtube', videoId: link.id, url: link.url, ...(org ? { org } : {}) });
      } catch (e) {
        fail(e?.code === 'permission-denied' ? 'Only admins and organization leaders can add videos.' : 'Could not publish. Check your connection and try again.');
        return;
      }
      sheet = null; sheetHost.replaceChildren();
      await reload({ jumpTo: 0 });
      announce.textContent = `Added: ${cur().title}`;
      addBtn.focus();
    }
    post.addEventListener('click', publish);
    sheetHost.replaceChildren(h('div', { class: 'wt-sheet-wrap', onkeydown: (e) => { if (e.key === 'Escape') closeSheet(); else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) publish(); } },
      h('button', { type: 'button', class: 'wt-sheet-back', 'aria-label': 'Close', tabindex: '-1', onclick: closeSheet }),
      h('div', { class: 'wt-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wt-sheet-title' },
        h('div', { class: 'wt-sheet-top' }, h('h2', { id: 'wt-sheet-title' }, 'Add a video'), h('button', { type: 'button', class: 'wt-sheet-x', 'aria-label': 'Close', onclick: closeSheet }, '✕')),
        h('div', { class: 'wt-fld' }, h('label', { for: 'wt-f-title' }, 'Title'), titleInput),
        h('div', { class: 'wt-fld' }, h('label', { for: 'wt-f-link' }, 'YouTube link'), linkInput),
        error, post)));
    titleInput.focus();
  }

  async function removeCurrent() {
    const v = cur();
    if (!v || v.sample || !confirm(`Remove "${v.title}" from Watch?`)) return;
    try {
      await data.admin.remove('videos', v.id);
    } catch {
      announce.textContent = 'Could not remove the video. Check your connection and try again.';
      return;
    }
    const keepAt = idx;
    await reload({ jumpTo: keepAt });
    announce.textContent = 'Video removed.';
  }

  let latestSession = null;
  const session = () => new Promise((resolve, reject) => (latestSession ? resolve(latestSession) : reject(new Error('not signed in'))));
  const stopSession = onSession((s) => {
    latestSession = s;
    canPost = s?.role === 'admin' || s?.role === 'leader';
    isStaff = ['admin', 'leader', 'staff'].includes(s?.role);
    paintTop();
  });

  fill(root,
    h('div', { class: 'wt' },
      h('h1', { id: 'page-title', class: 'sr', tabindex: '-1' }, 'Watch'),
      feed, pause,
      h('div', { class: 'wt-shade top', 'aria-hidden': 'true' }), h('div', { class: 'wt-shade bottom', 'aria-hidden': 'true' }),
      topBar, toast,
      h('div', { class: 'wt-side' }, soundBtn),
      h('div', { class: 'wt-info' }, h('div', { class: 'wt-who' }, avatar, name, chip), title, desc),
      bar, caption, announce, sheetHost));

  paintSound(); paintTop();
  reload({ resume: true }).catch(() => { if (alive) showVideos([], { resume: true }); });

  return () => {
    alive = false;
    stopSession();
    unmountPlayer();
    for (const id of timers) { clearInterval(id); clearTimeout(id); }
  };
}

// Post a story, like Instagram. The camera opens straight away, full screen, with no menu in between:
//   STORY  tap the shutter for a photo, hold it to record a video; while holding, slide up or down to zoom and slide left onto
//          the lock to keep recording hands-free. Pinch the picture to zoom, tap it to focus. The live picture is a 9:16
//          frame from the main lens, shown exactly as it will be posted, with no sound (the microphone opens only while recording).
//   VOICE  the shutter is a microphone: a tap (or a hold) records a voice message over a colour or a photo from the phone.
//   TEXT   words on a colour (tap the background to change it), then Next.
// Then a preview: Aa puts words on it (drag to move, pinch or wheel or the keys to resize, a palette to recolour), the pen
// draws with undo, the arrow saves the picture or recording to the phone, and "Your story" posts it.
// A recording runs in consecutive 30-second parts: a ring round the shutter fills with a mark at every part, the parts build
// up along the top, and it stops by itself at the limit (6 parts of video, 3 minutes; 10 of voice, 5 minutes). One file is
// kept per recording and watched in parts. Pictures are made on the phone at 1080 by 1920 (photos and text stories with the
// words drawn on; a see-through picture of the words laid over a video). Anything over 60 MB is refused.
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { h, fill, icon } from '../util.js';
import { ic } from '../ui.js';
import { uploadFile, shrinkPhoto, plainType, MAX_UPLOAD_BYTES, TOO_BIG } from '../uploads.js';
import { PART_SECONDS, PART_LIMITS, PALETTE, MAX_TEXT, DAY, HOLD_MS, LOCK_PX, MODES, ZOOM_RANGE, splitParts, partsFor, shownSeconds, maxSeconds, clock, tapAction, releaseAction, lockReached, ringFraction, ringMarks, nextColours, layerWords, clampZoom, zoomFromSlide, formatZoom, cropRect, cameraConstraints, pickCamera, ultraWideOf } from '../stories.js';
import { PEN_COLOURS, PEN_WIDTH, emptyOverlay, isEmpty, newLayer, clampSize, drawOverlay, hitLayer, composite, overlayImage } from '../story-canvas.js';
import { avatarEl } from './story-row.js';

// Shorter parts while testing against the local emulators (?partSeconds=2); 30 seconds everywhere else.
const params = new URLSearchParams(location.search);
const local = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('emulator');
export const PART = (local && Number(params.get('partSeconds'))) || PART_SECONDS;

// MP4 (H.264/AAC) first where the browser can record it, since every phone can play that; WebM otherwise.
const MIMES = {
  video: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'],
};
const pickMime = (kind) => MIMES[kind].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
const EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba' };
const REENCODE_OVER = 15 * 1024 * 1024; // a picked video bigger than this (or taller than 720p) is re-encoded on the phone when the browser can
const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;
const limitSeconds = (type) => PART_LIMITS[type] * PART;

// Reads a media file's length in seconds (and a video's height).
function probe(file, kind) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    const done = () => { const out = { duration: el.duration, height: el.videoHeight || 0 }; URL.revokeObjectURL(url); resolve(out); };
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) { done(); return; }
      // A recording made on a phone carries no length: asking for the very end makes the browser work it out.
      el.ondurationchange = () => { if (Number.isFinite(el.duration)) { el.ondurationchange = null; done(); } };
      el.currentTime = 1e101;
    };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read.')); };
    el.src = url;
  });
}

// Plays a picked video into a 720p canvas and records that, which both compresses it and keeps only the first 3 minutes.
// Takes as long as the clip. Only where the browser can capture a playing video (not Safari); elsewhere the file goes as is.
export const canReencode = () => typeof HTMLMediaElement.prototype.captureStream === 'function' && !!window.MediaRecorder;
function reencode(file, { maxSeconds: limit, onProgress }) {
  return new Promise((resolve, reject) => {
    const mime = pickMime('video');
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url; video.muted = false; video.playsInline = true; video.volume = 0.0001;
    video.onloadedmetadata = () => {
      const scale = Math.min(1, 720 / Math.max(1, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale / 2) * 2; canvas.height = Math.round(video.videoHeight * scale / 2) * 2;
      const ctx = canvas.getContext('2d');
      const tracks = [...canvas.captureStream(30).getVideoTracks(), ...video.captureStream().getAudioTracks()];
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: 2500000, audioBitsPerSecond: 96000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => { URL.revokeObjectURL(url); resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime }), duration: Math.min(video.currentTime, limit), mimeType: rec.mimeType || mime }); };
      let frame = 0;
      const draw = () => { if (video.paused || video.ended) return; ctx.drawImage(video, 0, 0, canvas.width, canvas.height); onProgress?.(video.currentTime / Math.min(video.duration, limit)); if (video.currentTime >= limit) { video.pause(); rec.stop(); return; } frame = requestAnimationFrame(draw); };
      video.onended = () => { cancelAnimationFrame(frame); if (rec.state === 'recording') rec.stop(); };
      video.onerror = () => reject(new Error('That video could not be read.'));
      video.play().then(() => { rec.start(1000); draw(); }).catch(reject);
    };
    video.onerror = () => reject(new Error('That video could not be read.'));
  });
}

const loadedImage = (url) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The picture could not be read.')); img.src = url; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function render(root) {
  let session = null;
  let closed = false;
  let stage = 'camera';       // camera | preview
  let mode = 'story';         // story | voice | text
  let facing = 'user';
  let stream = null;
  let streamTicket = 0;
  let recorder = null;
  let rec = null;             // { type, timer } while recording
  let elapsed = 0;            // seconds recorded so far
  let locked = false;         // the recording carries on with no finger on the shutter
  let handsFree = false;
  let timerOn = false;
  let flash = false;
  let moreOpen = false;
  let colours = PALETTE[0];   // the background in voice and text mode
  let voicePhoto = null;      // { blob, url }: a photo from the phone behind a voice message
  let typed = '';             // text mode
  let draft = null;           // { kind, blob, mimeType, url, duration, parts, colours, bg, note }
  let overlay = emptyOverlay();
  let tool = null;            // null | 'pen'
  let editing = null;         // { id, text, colour } while words are typed
  let penColour = '#FFFFFF';
  let textColour = '#FFFFFF';
  let busy = '';
  let error = '';
  let toast = '';
  let toastTimer = 0;
  let confirmOpen = false;
  let lastThumb = '';
  let press = null;           // { id, y0, started, timer } while the shutter is held
  let lastPress = 0;
  let boxes = [];             // where each piece of text sits on the editing canvas, in CSS pixels
  let gesture = null;         // a stroke being drawn, or a piece of text being dragged or pinched
  let camEl = null;           // the live camera, kept across redraws
  let drawCanvas = null;
  let mediaEl = null;
  let audioEl = null;
  let playing = false;
  let observer = null;
  let zoom = 1;               // the zoom shown: the camera's own when it can zoom, otherwise a digital crop
  let zoomCaps = null;        // { min, max } when the camera zooms itself
  let digital = 1;            // the digital zoom in the crop (1 when the camera zooms itself)
  let zoomTimer = 0;
  let focusTimer = 0;
  let devices = [];           // the cameras, known once permission has been given
  let lens = 'main';          // main | ultra: which back camera is in use
  let ultraWide = null;       // a named ultra-wide camera's id, 'zoom' when the main camera zooms below 1x, or null
  let mic = null;             // the microphone, open only while recording
  let canvasRec = null;       // the canvas that records exactly the picture on screen, when the camera's own picture would differ
  let starting = false;       // the microphone is being opened for a recording
  let cancelStart = false;    // the finger left the shutter before that finished
  let pinch = null;           // { d0, z0 } while two fingers are on the picture
  let lastConstraints = null; // what the camera was asked for (for the tests)
  // own-drag: the outlet's drag-to-scroll leaves this screen's drags alone. (Not "sp": that is the Home calendar's spacer class.)
  const host = h('div', { class: 'story-cam own-drag', 'data-stage': stage, 'data-mode': mode });
  root.append(host);
  const live = h('p', { class: 'sr', role: 'status' });
  const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };
  const say = (text) => { error = text; busy = ''; draw(); };
  const recording = () => !!rec;
  const title = () => (stage === 'preview' ? 'Your story' : mode === 'voice' ? 'Voice message' : mode === 'text' ? 'Text story' : 'Camera');
  const focusLater = (selector) => setTimeout(() => { host.querySelector(selector)?.focus({ preventScroll: true }); }, 0);
  const layerById = (id) => overlay.layers.find((l) => l.id === id);
  if (local) window.__storyEditor = () => ({
    stage, mode, colours: draft?.colours ?? colours, locked, recording: recording(), handsFree, overlay: JSON.parse(JSON.stringify(overlay)), draft: draft && { kind: draft.kind, parts: draft.parts, duration: draft.duration },
    zoom, digital, cameraZooms: !!zoomCaps, ultraWide: !!ultraWide, lens, constraints: lastConstraints,
    previewAudioTracks: stream ? stream.getAudioTracks().length : null, micOpen: !!mic, throughCanvas: !!canvasRec,
    recorderTracks: recorder ? { video: recorder.stream.getVideoTracks().length, audio: recorder.stream.getAudioTracks().length } : null,
  });

  // ---- The camera (picture only: the microphone is opened only while recording, so nothing ever plays back) ----
  function cam() {
    if (!camEl) {
      camEl = h('video', { class: 'sp-cam', autoplay: '', muted: '', playsinline: '', 'webkit-playsinline': '' }, h('track', { kind: 'captions', srclang: 'en', label: 'Captions', src: 'data:text/vtt,WEBVTT' }));
      camEl.muted = true; camEl.defaultMuted = true; camEl.volume = 0; camEl.playsInline = true; // the attribute alone does not silence a video made in script
    }
    return camEl;
  }
  const videoTrack = () => stream?.getVideoTracks?.()[0] ?? null;
  function stopMic() { mic?.getTracks().forEach((t) => t.stop()); mic = null; }
  function stopTracks() { stream?.getTracks().forEach((t) => t.stop()); stream = null; if (camEl) camEl.srcObject = null; stopMic(); canvasRec?.stop(); canvasRec = null; }
  const cameraFor = () => (lens === 'ultra' && typeof ultraWide === 'string' ? ultraWide : pickCamera(devices, facing));
  // data-ready on the root says the screen has settled (the camera is on, or nothing was needed, or it failed).
  async function openMedia() {
    stopTracks();
    error = '';
    delete host.dataset.ready;
    draw();
    if (mode !== 'story') { host.dataset.ready = '1'; return; } // voice: the microphone opens when recording starts; text: nothing
    const my = ++streamTicket;
    if (!navigator.mediaDevices?.getUserMedia) { say('The camera is not available in this browser. Choose a photo or video from your phone instead.'); host.dataset.ready = '1'; return; }
    const open = async (deviceId) => { lastConstraints = cameraConstraints(facing, deviceId); return navigator.mediaDevices.getUserMedia(lastConstraints); };
    let got;
    try { got = await open(cameraFor()); } catch {
      if (my !== streamTicket || closed) return;
      say('The camera could not be opened. Check the app may use the camera, or choose a photo or video from your phone.');
      host.dataset.ready = '1';
      return;
    }
    // With permission given, the cameras have names: use the main lens of this side if the browser picked another.
    if (!devices.length) {
      try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { devices = []; }
      const better = cameraFor();
      const current = got.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (better && current && better !== current && my === streamTicket && !closed) {
        try { const again = await open(better); got.getTracks().forEach((t) => t.stop()); got = again; } catch { /* keep the camera we have */ }
      }
    }
    if (my !== streamTicket || closed) { got.getTracks().forEach((t) => t.stop()); return; }
    stream = got;
    const caps = videoTrack()?.getCapabilities?.() || {};
    zoomCaps = caps.zoom && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max) && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null;
    ultraWide = ultraWideOf(devices, facing) || (zoomCaps && zoomCaps.min < 1 ? 'zoom' : null);
    cam().srcObject = stream;
    cam().play?.().catch(() => {});
    applyZoom(lens === 'ultra' && ultraWide === 'zoom' ? zoomCaps.min : 1, { quiet: true });
    applyTorch();
    draw();
    host.dataset.ready = '1';
  }
  const hasTorch = () => !!videoTrack()?.getCapabilities?.()?.torch;
  function applyTorch() { const track = videoTrack(); if (track && hasTorch()) track.applyConstraints({ advanced: [{ torch: flash }] }).catch(() => {}); }
  function flipCamera() { if (recording() || starting) return; facing = facing === 'user' ? 'environment' : 'user'; lens = 'main'; openMedia(); }

  // ---- Zoom: the camera's own where it has one, otherwise a digital crop of the picture (the same crop is posted) ----
  const namedWide = () => typeof ultraWide === 'string' && ultraWide !== 'zoom';
  const shownZoom = () => (lens === 'ultra' && namedWide() ? zoom * 0.5 : zoom); // the wide lens counts as 0.5x
  const chipOn = (value) => (value < 1 ? lens === 'ultra' : lens === 'main' && Math.abs(zoom - 1) < 0.05);
  function applyZoom(z, { quiet = false } = {}) {
    if (zoomCaps) { zoom = clampZoom(z, zoomCaps); digital = 1; videoTrack()?.applyConstraints({ advanced: [{ zoom }] }).catch(() => {}); }
    else { zoom = clampZoom(z, ZOOM_RANGE); digital = zoom; }
    if (ultraWide === 'zoom') lens = zoom < 1 ? 'ultra' : 'main'; // one camera that zooms out below 1x
    if (camEl) camEl.style.transform = `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${digital})`;
    host.querySelectorAll('.sp-chip').forEach((b) => b.setAttribute('aria-pressed', String(chipOn(Number(b.dataset.zoom)))));
    if (quiet) return;
    const label = host.querySelector('.sp-zoom');
    if (label) { label.textContent = formatZoom(shownZoom()); label.classList.add('show'); }
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => { host.querySelector('.sp-zoom')?.classList.remove('show'); announce(`Zoom ${formatZoom(shownZoom())}`); }, 1000);
  }
  function setLens(which) {
    if (recording() || starting) return;
    if (which === 'ultra' && !ultraWide) return;
    if (ultraWide === 'zoom') { applyZoom(which === 'ultra' ? zoomCaps.min : 1); return; } // the same camera, zoomed out or back
    if (which === lens) { applyZoom(1); return; }
    lens = which;
    openMedia(); // the other camera
  }
  // A tap on the picture asks the camera to focus there, where it can.
  function focusAt(clientX, clientY) {
    const frame = host.querySelector('.sp-cam-frame');
    const track = videoTrack();
    if (!frame || !track) return;
    const r = frame.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    const caps = track.getCapabilities?.() || {};
    const wanted = {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('single-shot')) wanted.focusMode = 'single-shot';
    if (caps.pointsOfInterest) wanted.pointsOfInterest = [{ x: facing === 'user' ? 1 - fx : fx, y: fy }];
    if (!Object.keys(wanted).length) return;
    track.applyConstraints({ advanced: [wanted] }).catch(() => {});
    const ring = frame.querySelector('.sp-focus');
    if (ring) { ring.style.left = `${clientX - r.left}px`; ring.style.top = `${clientY - r.top}px`; ring.classList.add('show'); clearTimeout(focusTimer); focusTimer = setTimeout(() => ring.classList.remove('show'), 800); }
  }
  function setMode(m) {
    if (!MODES.includes(m) || m === mode || recording() || starting || busy) return;
    mode = m; locked = false;
    openMedia();
    if (m === 'text') focusLater('.sp-text-input');
  }
  const focusMode = () => focusLater('.sp-mode[aria-checked="true"]');
  function cycleColours() {
    colours = nextColours(colours);
    const bg = host.querySelector('.sp-bg');
    if (bg) bg.style.background = `linear-gradient(160deg, ${colours[0]}, ${colours[1]})`;
    announce('Colour changed');
  }

  // ---- The shutter: tap, hold, slide up or down to zoom, slide left onto the lock; the keyboard: Space or Enter, the arrows ----
  function pressStart(id, x, y) {
    if (press || busy || confirmOpen || stage !== 'camera' || closed) return;
    press = { id, x0: x, y0: y, zoom0: zoom, started: false, timer: 0 };
    lastPress = performance.now();
    cancelStart = false;
    host.querySelector('.sp-shutter')?.classList.add('held');
    if (!recording() && !starting && mode !== 'text' && !handsFree && !timerOn) {
      press.timer = setTimeout(() => { if (!press || press.id !== id) return; press.started = true; startRecording(mode === 'voice' ? 'audio' : 'video'); }, HOLD_MS);
    }
  }
  function pressMove(id, x, y) {
    if (!press || press.id !== id || !press.started || !recording()) return;
    if (mode === 'story' && Number.isFinite(y)) applyZoom(zoomFromSlide(press.zoom0, y - press.y0, zoomCaps || ZOOM_RANGE)); // up zooms in, down zooms out
    if (!locked && Number.isFinite(x) && lockReached(press.x0, x)) { locked = true; setRecState(); announce('Locked. Tap the shutter to stop.'); try { navigator.vibrate?.(15); } catch { /* fine */ } }
  }
  function pressEnd(id, cancelled, x) {
    if (!press || press.id !== id) return;
    const p = press;
    press = null;
    lastPress = performance.now();
    clearTimeout(p.timer);
    host.querySelector('.sp-shutter')?.classList.remove('held');
    if (p.started) { // a hold that recorded: locked carries on, otherwise letting go stops it
      // Lifting the finger over the lock counts too, in case the moves on the way never came through.
      if (!cancelled && !locked && Number.isFinite(x) && lockReached(p.x0, x)) { locked = true; announce('Locked. Tap the shutter to stop.'); }
      if (!recording()) { if (!locked) cancelStart = true; setRecState(); return; } // the microphone was still opening
      if (releaseAction({ locked }) === 'stop') stopRecording(); else setRecState();
      return;
    }
    if (!cancelled) tap();
  }
  function tap() {
    if (busy || confirmOpen || stage !== 'camera') return;
    const action = tapAction({ mode, recording: recording(), handsFree });
    if (action === 'next') { nextFromText(); return; }
    if (action === 'stop') { stopRecording(); return; }
    if (timerOn) { countdown(3).then((ok) => { if (ok) doTap(action); }); return; }
    doTap(action);
  }
  function doTap(action) {
    if (action === 'photo') takePhoto();
    else if (action === 'start') { locked = true; startRecording(mode === 'voice' ? 'audio' : 'video'); }
  }
  function attachShutter(button) {
    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { button.setPointerCapture(e.pointerId); } catch { /* fine */ }
      pressStart(e.pointerId, e.clientX, e.clientY);
    });
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { // zoom from the keyboard, held or not
        if (mode !== 'story') return;
        e.preventDefault();
        applyZoom(zoom * (e.key === 'ArrowUp' ? 1.25 : 0.8), {});
        return;
      }
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pressStart('key', 0, 0); }
      else if (e.key === 'ArrowLeft' && press?.id === 'key') { e.preventDefault(); pressMove('key', -LOCK_PX, NaN); }
    });
    button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pressEnd('key', false, NaN); } });
    button.addEventListener('click', () => { if (performance.now() - lastPress < 600) return; tap(); }); // a tap sent with no pointer or key events (some assistive tools)
  }
  host.addEventListener('pointermove', (e) => pressMove(e.pointerId, e.clientX, e.clientY));
  host.addEventListener('pointerup', (e) => pressEnd(e.pointerId, false, e.clientX));
  host.addEventListener('pointercancel', (e) => pressEnd(e.pointerId, true, NaN));

  function countdown(n) {
    return new Promise((resolve) => {
      let left = n;
      const step = () => {
        if (closed || stage !== 'camera') { resolve(false); return; }
        const el = host.querySelector('.sp-countdown');
        if (left === 0) { if (el) el.textContent = ''; resolve(true); return; }
        if (el) el.textContent = String(left);
        announce(String(left));
        left--;
        setTimeout(step, 1000);
      };
      step();
    });
  }
  const screenFlash = () => new Promise((resolve) => {
    const fx = host.querySelector('.sp-flashfx');
    if (!fx) { resolve(); return; }
    fx.classList.add('on');
    setTimeout(() => { resolve(); setTimeout(() => fx.classList.remove('on'), 120); }, 220);
  });

  async function takePhoto() {
    const v = camEl;
    if (!v || !v.videoWidth) { say('The camera is not ready yet.'); return; }
    if (flash && !hasTorch()) await screenFlash(); // the screen lights the face when there is no torch
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const r = cropRect(v.videoWidth, v.videoHeight, digital); // the part on screen: the story's shape, and the digital zoom
    if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1); } // the preview is mirrored; so is the photo
    ctx.drawImage(v, r.x, r.y, r.width, r.height, 0, 0, W, H);
    const blob = await new Promise((r2) => canvas.toBlob(r2, 'image/jpeg', 0.9));
    if (!blob) { say('The photo could not be taken.'); return; }
    announce('Photo taken');
    setDraft({ kind: 'photo', blob, mimeType: 'image/jpeg', duration: shownSeconds('photo', 0), parts: partsFor('photo', 0) });
  }

  // The camera's own picture is recorded when it is already what is on screen: a 9:16 picture, the back camera, no digital
  // zoom. Otherwise (a mirrored selfie, a digital zoom, or a camera that only gives a wider picture) the picture on screen is
  // drawn to a canvas and that is recorded, so what is seen is what is posted.
  function needsCanvas() {
    if (!camEl?.videoWidth || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false; // no way to record the screen's picture: the camera's own is recorded
    const portrait = Math.abs(camEl.videoWidth / camEl.videoHeight - 9 / 16) < 0.03;
    return digital !== 1 || facing === 'user' || !portrait;
  }
  function startCanvasFeed() {
    const v = camEl;
    const first = cropRect(v.videoWidth, v.videoHeight, 1);
    const H = Math.min(1280, Math.round(first.height / 2) * 2);
    const W = Math.round((H * 9) / 16 / 2) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const out = canvas.captureStream(30);
    let on = true;
    let raf = 0;
    let last = 0;
    const draw = (t = 0) => {
      if (!on) return;
      if (t - last >= 30) { // about 30 frames a second, whatever the screen's own rate
        last = t;
        const r = cropRect(v.videoWidth, v.videoHeight, digital);
        ctx.save();
        if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1); }
        ctx.drawImage(v, r.x, r.y, r.width, r.height, 0, 0, W, H);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return { stream: out, stop: () => { on = false; cancelAnimationFrame(raf); out.getTracks().forEach((t) => t.stop()); } };
  }
  // One continuous recording; the parts are worked out from the time that has run. The microphone opens here and closes at the end.
  async function startRecording(type) {
    if (recording() || starting || busy) return;
    if (type === 'video' && !stream) { say('The camera is not ready yet.'); return; }
    if (!window.MediaRecorder) { say('This browser cannot record. Choose a video from your phone instead.'); return; }
    starting = true;
    let got;
    try { got = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {
      starting = false;
      say('The microphone could not be opened. Check the app may use it.');
      return;
    }
    const wrongTime = closed || stage !== 'camera' || mode !== (type === 'audio' ? 'voice' : 'story') || (type === 'video' && !stream) || cancelStart;
    if (wrongTime) { got.getTracks().forEach((t) => t.stop()); starting = false; cancelStart = false; locked = false; setRecState(); return; }
    mic = got;
    let picture = [];
    if (type === 'video') {
      if (needsCanvas()) { try { canvasRec = startCanvasFeed(); picture = canvasRec.stream.getVideoTracks(); } catch { canvasRec = null; picture = stream.getVideoTracks(); } }
      else picture = stream.getVideoTracks();
    }
    const mime = pickMime(type);
    const chunks = [];
    try {
      recorder = new MediaRecorder(new MediaStream([...picture, ...mic.getAudioTracks()]), { mimeType: mime || undefined, ...(type === 'video' ? { videoBitsPerSecond: 2500000, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 96000 }) });
    } catch { stopMic(); canvasRec?.stop(); canvasRec = null; starting = false; say('This browser cannot record. Choose a video from your phone instead.'); return; }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const duration = Math.max(1, Math.round(elapsed));
      const blob = new Blob(chunks, { type: recorder?.mimeType || mime });
      recorder = null;
      locked = false;
      stopMic();
      canvasRec?.stop();
      canvasRec = null;
      if (closed) return;
      setDraft({ kind: type, blob, mimeType: blob.type, duration, parts: splitParts(Math.min(duration, limitSeconds(type)), { partSeconds: PART, maxParts: PART_LIMITS[type] }), bg: type === 'audio' ? voicePhoto : null });
    };
    elapsed = 0;
    error = '';
    const t0 = performance.now();
    rec = { type, timer: setInterval(() => {
      elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= limitSeconds(type)) { elapsed = limitSeconds(type); stopRecording(); return; }
      paintRecording();
    }, 200) };
    recorder.start(1000);
    starting = false;
    announce('Recording');
    host.querySelector('.sp-error')?.remove();
    setRecState();
  }
  function stopRecording() {
    if (!rec) return;
    clearInterval(rec.timer);
    rec = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else { locked = false; stopMic(); canvasRec?.stop(); canvasRec = null; setRecState(); }
  }
  const shutterLabel = () => (recording() ? 'Stop recording' : mode === 'text' ? 'Next' : mode === 'voice' ? 'Record a voice message' : handsFree ? 'Record a video' : timerOn ? 'Take a photo after 3 seconds' : 'Take a photo. Hold to record a video');
  // The recording state is painted onto the controls in place, so a finger on the shutter keeps hold of it.
  function setRecState() {
    const s = host.querySelector('.sp-shutter');
    if (!s) return;
    const on = recording();
    s.classList.toggle('rec', on);
    s.classList.toggle('locked', on && locked);
    s.setAttribute('aria-label', shutterLabel());
    host.querySelectorAll('.sp-rail button, .sp-mode, .sp-flip, #sp-file').forEach((b) => { b.disabled = on; });
    const lock = host.querySelector('.sp-lock');
    if (lock) { lock.classList.toggle('on', on && locked); lock.classList.toggle('show', on && (locked || !!press)); }
    const t = host.querySelector('.sp-time');
    if (t) t.textContent = on ? clock(elapsed) : '';
    if (!on) { const prog = host.querySelector('.sp-ring .prog'); if (prog) prog.style.strokeDashoffset = RING_C.toFixed(2); }
  }
  function paintRecording() {
    const type = rec?.type;
    if (!type) return;
    const prog = host.querySelector('.sp-ring .prog');
    if (prog) prog.style.strokeDashoffset = (RING_C * (1 - ringFraction(elapsed, limitSeconds(type)))).toFixed(2);
    host.querySelector('.sp-parts')?.replaceWith(partsBar(type));
    const t = host.querySelector('.sp-time');
    if (t) t.textContent = clock(elapsed);
  }
  // The parts along the top: one segment per part so far, the last one growing (all of them, full, on the preview).
  function partsBar(type, { done = false } = {}) {
    const max = PART_LIMITS[type];
    const total = done ? draft.duration : limitSeconds(type);
    const parts = done ? draft.parts : (recording() || elapsed > 0 ? splitParts(elapsed, { partSeconds: PART, maxParts: max }) : []);
    const bar = h('div', { class: 'sp-parts', role: 'progressbar', 'aria-label': done ? 'Parts' : 'Recording', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(Math.floor(done ? draft.duration : elapsed)), 'aria-valuetext': clock(done ? draft.duration : elapsed) });
    for (let k = 0; k < (done ? parts.length : max); k++) {
      const p = parts[k];
      bar.append(h('span', { class: `sp-part${p ? ' on' : ''}` }, p ? h('span', { class: 'sp-part-fill', style: `width:${Math.round(((p.end - p.start) / PART) * 100)}%` }) : null));
    }
    return bar;
  }
  const ring = (type) => icon(`<svg class="sp-ring" viewBox="0 0 96 96" aria-hidden="true"><circle class="track" cx="48" cy="48" r="${RING_R}"/><circle class="prog" cx="48" cy="48" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" transform="rotate(-90 48 48)" style="stroke-dashoffset:${(RING_C * (1 - ringFraction(elapsed, limitSeconds(type)))).toFixed(2)}"/>${ringMarks(PART_LIMITS[type]).map((deg) => `<line class="mark" x1="48" y1="1" x2="48" y2="9" transform="rotate(${deg.toFixed(2)} 48 48)"/>`).join('')}</svg>`);

  // ---- From the phone ----
  async function pickFile(file) {
    if (!file || busy) return;
    error = '';
    if (file.size > MAX_UPLOAD_BYTES) { say(TOO_BIG); return; }
    try {
      if (file.type.startsWith('image/')) {
        busy = 'Preparing the photo…'; draw();
        const blob = await shrinkPhoto(file, { max: 1920 });
        if (closed) return;
        if (lastThumb) URL.revokeObjectURL(lastThumb);
        lastThumb = URL.createObjectURL(blob);
        if (mode === 'voice') { if (voicePhoto?.url) URL.revokeObjectURL(voicePhoto.url); voicePhoto = { blob, url: URL.createObjectURL(blob) }; busy = ''; draw(); return; }
        setDraft({ kind: 'photo', blob, mimeType: 'image/jpeg', duration: shownSeconds('photo', 0), parts: partsFor('photo', 0) });
      } else if (file.type.startsWith('video/') && mode !== 'voice') {
        busy = 'Reading the video…'; draw();
        const { duration, height } = await probe(file, 'video');
        let blob = file; let mimeType = file.type; let length = duration;
        if (canReencode() && (file.size > REENCODE_OVER || height > 720)) {
          busy = 'Making the video smaller… 0%'; draw();
          const out = await reencode(file, { maxSeconds: maxSeconds('video'), onProgress: (f) => { busy = `Making the video smaller… ${Math.round(f * 100)}%`; paintBusy(); } });
          blob = out.blob; mimeType = out.mimeType; length = out.duration;
        }
        if (closed) return;
        const shown = Math.max(1, Math.min(Math.round(length), maxSeconds('video')));
        setDraft({ kind: 'video', blob, mimeType, duration: shown, parts: splitParts(shown, { partSeconds: PART, maxParts: PART_LIMITS.video }), note: length > maxSeconds('video') ? 'Only the first 3 minutes will be shown.' : '' });
      } else say(mode === 'voice' ? 'Choose a photo.' : 'Choose a photo or a video.');
    } catch (e) { say(e.message || 'That file could not be used.'); }
  }

  // ---- The draft and the preview ----
  function setDraft(d) {
    busy = ''; error = '';
    if (draft?.url) URL.revokeObjectURL(draft.url);
    draft = { colours, bg: null, note: '', ...d, url: d.blob ? URL.createObjectURL(d.blob) : '' };
    overlay = d.overlay ?? emptyOverlay();
    tool = d.tool ?? null;
    editing = null; boxes = []; gesture = null; moreOpen = false; locked = false; playing = false;
    mediaEl = null; audioEl = null; drawCanvas = null;
    stopTracks(); // the camera is off while the preview is up
    stage = 'preview';
    draw();
    focusLater(tool === 'pen' ? '.sp-rail button[aria-label="Draw"]' : '.sp-share');
  }
  function nextFromText() {
    const text = typed.trim().slice(0, MAX_TEXT);
    if (!text) return;
    setDraft({ kind: 'text', duration: shownSeconds('text', 0), parts: partsFor('text', 0), overlay: { strokes: [], layers: [newLayer(text, { colour: textColour })] } });
  }
  const drawingStory = () => setDraft({ kind: 'text', duration: shownSeconds('text', 0), parts: partsFor('text', 0), tool: 'pen' });
  function discard() {
    if (draft?.url) URL.revokeObjectURL(draft.url);
    draft = null; overlay = emptyOverlay(); tool = null; editing = null; confirmOpen = false; typed = ''; error = '';
    stage = 'camera';
    openMedia();
    focusLater('.sp-shutter');
  }
  function makeMedia(d) {
    if (d.kind === 'photo') return h('img', { class: 'sp-media', src: d.url, alt: 'Your photo' });
    if (d.kind === 'video') {
      const v = h('video', { class: 'sp-media', src: d.url, loop: '', playsinline: '', 'webkit-playsinline': '' }, h('track', { kind: 'captions', srclang: 'en', label: 'Captions', src: 'data:text/vtt,WEBVTT' }));
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      return v;
    }
    if (d.kind === 'audio' && d.bg) return h('img', { class: 'sp-media cover', src: d.bg.url, alt: '' });
    return null;
  }
  function voiceMark() {
    audioEl ??= h('audio', { src: draft.url, preload: 'auto', onended: () => { playing = false; paintPlay(); } });
    return h('div', { class: 'sp-voice-mark' },
      h('span', { class: 'sp-voice-icon', 'aria-hidden': 'true' }, ic('mic', 40, 1.8)),
      h('button', { type: 'button', class: 'sp-icon sp-play', 'aria-label': playing ? 'Pause' : 'Play', onclick: () => { if (playing) { audioEl.pause(); playing = false; } else { playing = true; audioEl.play().catch(() => { playing = false; paintPlay(); }); } paintPlay(); } }, ic(playing ? 'pause' : 'play', 24, 2)),
      audioEl);
  }
  function paintPlay() { const b = host.querySelector('.sp-play'); if (!b) return; b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); b.replaceChildren(ic(playing ? 'pause' : 'play', 24, 2)); }

  // The editing canvas: the overlay drawn at the frame's size, the same routine as the posted picture.
  function fitCanvas() {
    if (!drawCanvas?.isConnected) return;
    const r = drawCanvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    const hh = Math.round(r.height * dpr);
    if (drawCanvas.width !== w || drawCanvas.height !== hh) { drawCanvas.width = w; drawCanvas.height = hh; }
    paintOverlay();
  }
  function paintOverlay() {
    if (!drawCanvas?.width) return;
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    const px = drawOverlay(ctx, drawCanvas.width, drawCanvas.height, overlay);
    const k = drawCanvas.width / (drawCanvas.getBoundingClientRect().width || 1);
    boxes = px.map((b) => ({ id: b.id, left: b.left / k, top: b.top / k, width: b.width / k, height: b.height / k }));
    const frame = host.querySelector('.sp-frame');
    if (frame) { frame.dataset.layers = String(overlay.layers.length); frame.dataset.strokes = String(overlay.strokes.length); }
    const undo = host.querySelector('button[aria-label="Undo"]');
    if (undo) undo.disabled = !overlay.strokes.length;
  }
  const bringToFront = (id) => { const l = layerById(id); if (l) { overlay.layers = [...overlay.layers.filter((x) => x.id !== id), l]; } };
  function attachCanvas(canvas) {
    const frac = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (busy || editing || confirmOpen || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const [fx, fy, px, py] = frac(e);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
      if (tool === 'pen') {
        const stroke = { colour: penColour, width: PEN_WIDTH, points: [[fx, fy]] };
        overlay.strokes.push(stroke);
        gesture = { kind: 'stroke', id: e.pointerId, stroke };
        paintOverlay();
        return;
      }
      if (gesture?.kind === 'drag') { // a second finger: pinch to resize
        gesture.pointers.set(e.pointerId, [e.clientX, e.clientY]);
        const pts = [...gesture.pointers.values()];
        if (pts.length === 2) { gesture.pinch0 = dist(pts[0], pts[1]); gesture.size0 = layerById(gesture.id)?.size ?? 0.085; }
        return;
      }
      const id = hitLayer(boxes, px, py);
      if (!id) { gesture = { kind: 'none', id: e.pointerId }; return; }
      const l = layerById(id);
      gesture = { kind: 'drag', pid: e.pointerId, id, dx: fx - l.x, dy: fy - l.y, moved: false, pointers: new Map([[e.pointerId, [e.clientX, e.clientY]]]), pinch0: null };
      bringToFront(id);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!gesture) return;
      const [fx, fy] = frac(e);
      if (gesture.kind === 'stroke') { if (e.pointerId === gesture.id) { gesture.stroke.points.push([fx, fy]); paintOverlay(); } return; }
      if (gesture.kind !== 'drag') return;
      if (gesture.pointers.has(e.pointerId)) gesture.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const l = layerById(gesture.id);
      if (!l) return;
      if (gesture.pointers.size >= 2 && gesture.pinch0) {
        const pts = [...gesture.pointers.values()];
        l.size = clampSize((gesture.size0 * dist(pts[0], pts[1])) / gesture.pinch0);
        gesture.moved = true;
        paintOverlay();
        return;
      }
      if (e.pointerId !== gesture.pid) return;
      const nx = fx - gesture.dx;
      const ny = fy - gesture.dy;
      if (Math.abs(nx - l.x) > 0.005 || Math.abs(ny - l.y) > 0.005) gesture.moved = true;
      if (gesture.moved) { l.x = Math.max(0.02, Math.min(0.98, nx)); l.y = Math.max(0.02, Math.min(0.98, ny)); paintOverlay(); }
    });
    const up = (e) => {
      if (!gesture) return;
      const ended = e.type !== 'pointercancel';
      if (gesture.kind === 'stroke') {
        if (e.pointerId !== gesture.id) return;
        if (ended) { const [fx, fy] = frac(e); gesture.stroke.points.push([fx, fy]); } // where the pen lifted, even if no move came through
        gesture = null;
        paintOverlay();
        return;
      }
      if (gesture.kind === 'drag') {
        // The place the finger lifted is where the words end up, even when the moves in between never came through.
        if (ended && gesture.pointers.size === 1 && e.pointerId === gesture.pid) {
          const [fx, fy] = frac(e);
          const l = layerById(gesture.id);
          const nx = fx - gesture.dx;
          const ny = fy - gesture.dy;
          if (l && (Math.abs(nx - l.x) > 0.005 || Math.abs(ny - l.y) > 0.005)) { gesture.moved = true; l.x = Math.max(0.02, Math.min(0.98, nx)); l.y = Math.max(0.02, Math.min(0.98, ny)); paintOverlay(); }
        }
        gesture.pointers.delete(e.pointerId);
        if (gesture.pointers.size) { gesture.pinch0 = null; return; }
        const g = gesture;
        gesture = null;
        if (!g.moved && e.type !== 'pointercancel') startText(g.id); else paintLayerList();
        return;
      }
      gesture = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      if (tool === 'pen' || editing || !overlay.layers.length) return;
      const [, , px, py] = frac(e);
      const l = layerById(hitLayer(boxes, px, py) ?? overlay.layers.at(-1).id);
      if (!l) return;
      e.preventDefault();
      l.size = clampSize(l.size * (e.deltaY < 0 ? 1.1 : 0.9));
      paintOverlay();
    }, { passive: false });
  }
  // Words: typed in a box over the picture, then a piece of text that can be moved, resized and recoloured.
  function startText(id) {
    if (busy || confirmOpen) return;
    const l = id ? layerById(id) : null;
    editing = { id: l ? l.id : null, text: l ? l.text : '', colour: l ? l.colour : textColour };
    tool = null;
    draw();
    focusLater('.sp-edit-input');
  }
  function finishText() {
    if (!editing) return;
    const e = editing;
    editing = null;
    const text = e.text.trim().slice(0, MAX_TEXT);
    textColour = e.colour;
    if (e.id) {
      const l = layerById(e.id);
      if (!text) overlay.layers = overlay.layers.filter((x) => x.id !== e.id);
      else if (l) { l.text = text; l.colour = e.colour; }
    } else if (text) overlay.layers.push(newLayer(text, { colour: e.colour }));
    draw();
    focusLater('.sp-rail button[aria-label="Text"]');
  }
  function layerKeys(e, l) {
    const step = 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); l.x = Math.max(0.02, Math.min(0.98, l.x + moves[e.key][0])); l.y = Math.max(0.02, Math.min(0.98, l.y + moves[e.key][1])); paintOverlay(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); l.size = clampSize(l.size * 1.1); paintOverlay(); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); l.size = clampSize(l.size / 1.1); paintOverlay(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); overlay.layers = overlay.layers.filter((x) => x.id !== l.id); paintOverlay(); paintLayerList(); focusLater('.sp-rail button[aria-label="Text"]'); }
  }
  const layerLabel = (l) => `Text: ${l.text}. Enter edits it, the arrow keys move it, plus and minus resize it, Delete removes it`;
  const layerList = () => h('div', { class: 'sp-layers' }, overlay.layers.map((l) => h('button', { type: 'button', 'aria-label': layerLabel(l), onkeydown: (e) => layerKeys(e, l), onclick: () => startText(l.id) }, l.text)));
  function paintLayerList() { host.querySelector('.sp-layers')?.replaceWith(layerList()); }
  function undo() { overlay.strokes.pop(); paintOverlay(); }
  const swatches = (picked, onPick, label) => h('div', { class: 'sp-palette', role: 'radiogroup', 'aria-label': label },
    PEN_COLOURS.map(([c, name]) => h('button', { type: 'button', class: 'sp-swatch', role: 'radio', 'aria-checked': String(c === picked), 'aria-label': name, style: `background:${c}`, onclick: (e) => { onPick(c); e.currentTarget.parentElement.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); } })));

  // ---- Saving and posting ----
  const extOf = (type) => EXT[plainType(type)] || 'bin';
  async function picture() {
    return composite({ media: draft.kind === 'photo' ? await loadedImage(draft.url) : draft.kind === 'audio' && draft.bg ? await loadedImage(draft.bg.url) : null, fit: draft.kind === 'audio' ? 'cover' : 'contain', colours: draft.colours, overlay });
  }
  async function saveToPhone() {
    if (!draft || busy) return;
    try {
      const still = draft.kind === 'photo' || draft.kind === 'text';
      const blob = still ? await picture() : draft.blob;
      const link = h('a', { href: URL.createObjectURL(blob), download: still ? 'life-centre-story.jpg' : `life-centre-story.${extOf(draft.mimeType || blob.type)}` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      showToast('Saved');
    } catch (e) { say(e.message || 'Could not save.'); }
  }
  function showToast(text) { toast = text; clearTimeout(toastTimer); draw(); toastTimer = setTimeout(() => { toast = ''; if (!closed) draw(); }, 2000); }
  async function post() {
    if (!draft || busy || editing) return;
    const words = layerWords(overlay.layers);
    let type = draft.kind;
    if (type === 'text' && !words) {
      if (isEmpty(overlay)) { say('Write something first.'); return; }
      type = 'photo'; // a drawing on a colour is a picture
    }
    error = ''; busy = 'Posting…'; draw();
    try {
      const values = {
        author: session.email, authorName: (session.displayName || session.name || session.email).slice(0, 80), authorPhoto: session.photo || undefined,
        type, colours: draft.colours, expiresAt: Date.now() + DAY, text: words || undefined,
      };
      if (type === 'photo' || type === 'text') {
        values.duration = shownSeconds(type, 0); values.parts = partsFor(type, 0);
        busy = 'Making the picture…'; paintBusy();
        const blob = await picture();
        busy = 'Uploading…'; paintBusy();
        values.mediaUrl = await uploadFile(blob, { kind: 'stories' });
        values.mediaType = 'image/jpeg';
      } else {
        values.duration = draft.duration; values.parts = draft.parts;
        busy = type === 'video' ? 'Uploading your video…' : 'Uploading your voice message…'; paintBusy();
        values.mediaUrl = await uploadFile(draft.blob, { kind: 'stories' });
        values.mediaType = plainType(draft.mimeType || draft.blob.type);
        if (type === 'video' && !isEmpty(overlay)) { busy = 'Adding the words…'; paintBusy(); values.overlay = await uploadFile(await overlayImage(overlay), { kind: 'stories' }); }
        if (type === 'audio' && (draft.bg || !isEmpty(overlay))) { busy = 'Making the picture…'; paintBusy(); values.bgImage = await uploadFile(await picture(), { kind: 'stories' }); }
      }
      await data.admin.save('stories', session.email, values);
      busy = '';
      location.hash = '#/';
    } catch (e) {
      busy = '';
      // The rules refuse a story whose 24-hour expiry disagrees with the server by more than an hour: a wrong phone clock.
      say(e.code === 'permission-denied' ? (session?.postStories ? 'Could not post. Check the phone\'s date and time, then try again.' : 'This account is not allowed to post stories.') : (e.message || 'Could not post. Please try again.'));
    }
  }
  function paintBusy() { const t = host.querySelector('.sp-busy-text'); if (t) t.textContent = busy; }

  // ---- Screens ----
  const heading = () => h('h1', { id: 'page-title', class: 'sr', tabindex: '-1' }, title());
  const errorEl = () => (error ? h('p', { class: 'sp-error', role: 'alert' }, error) : null);
  const moreButton = () => h('button', { type: 'button', class: `sp-icon${moreOpen ? ' up' : ''}`, 'aria-label': moreOpen ? 'Fewer tools' : 'More tools', 'aria-expanded': String(moreOpen), onclick: () => { moreOpen = !moreOpen; draw(); focusLater(`.sp-rail button[aria-label="${moreOpen ? 'Fewer tools' : 'More tools'}"]`); } }, ic('down', 22, 2.2));

  // Taps and swipes on the camera view: sideways changes the mode; a tap on a colour background changes the colour; on the
  // live picture a tap focuses there and two fingers pinch to zoom.
  function attachView(view, { buttons = false } = {}) { // buttons: a swipe may start on one of the view's own buttons (the mode strip)
    let start = null;
    const fingers = new Map();
    view.addEventListener('pointerdown', (e) => {
      if (e.target.closest(buttons ? 'textarea, input, label, a' : 'textarea, button, input, label, a')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!buttons) { try { view.setPointerCapture(e.pointerId); } catch { /* fine */ } } // not over buttons: a capture would take their taps away
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      if (fingers.size >= 2 && mode === 'story' && stage === 'camera') { // a second finger: a pinch, not a tap or a swipe
        const [a, b] = [...fingers.values()];
        pinch = { d0: Math.max(1, dist(a, b)), z0: zoom };
        start = null;
        return;
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    view.addEventListener('pointermove', (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && fingers.size >= 2) { const [a, b] = [...fingers.values()]; applyZoom(pinch.z0 * (dist(a, b) / pinch.d0)); }
    });
    const end = (e) => {
      fingers.delete(e.pointerId);
      if (pinch) { if (fingers.size < 2) pinch = null; start = null; return; }
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (e.type === 'pointercancel' || recording()) return;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) { const i = MODES.indexOf(mode); setMode(MODES[(i + (dx < 0 ? 1 : 2)) % 3]); return; }
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        if (mode === 'story') focusAt(e.clientX, e.clientY);
        else if (!(mode === 'voice' && voicePhoto)) cycleColours();
      }
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
  }

  function cameraScreen() {
    const type = mode === 'voice' ? 'audio' : 'video';
    const isRec = recording();
    const view = h('div', { class: 'sp-view' });
    if (mode === 'story') { // the live picture in the 9:16 frame a story has, so what is seen is what is posted
      cam().classList.toggle('mirror', facing === 'user');
      cam().style.transform = `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${digital})`;
      view.append(h('div', { class: 'sp-cam-frame' }, cam(), h('span', { class: 'sp-focus', 'aria-hidden': 'true' })), h('span', { class: 'sp-zoom', 'aria-hidden': 'true' }, formatZoom(shownZoom())));
    } else {
      view.append(h('div', { class: 'sp-bg', style: `background:linear-gradient(160deg, ${colours[0]}, ${colours[1]})` }, mode === 'voice' && voicePhoto ? h('img', { src: voicePhoto.url, alt: '' }) : null));
      if (mode === 'text') view.append(h('textarea', { class: 'sp-text-input', 'aria-label': 'Your words', maxlength: String(MAX_TEXT), rows: '4', oninput: (e) => { typed = e.target.value; const s = host.querySelector('.sp-shutter'); if (s) s.disabled = !typed.trim(); } }, typed));
      else view.append(h('div', { class: 'sp-voice-mark', 'aria-hidden': 'true' }, h('span', { class: 'sp-voice-icon' }, ic('mic', 40, 1.8))));
    }
    view.append(h('div', { class: 'sp-countdown', 'aria-hidden': 'true' }), h('div', { class: 'sp-flashfx', 'aria-hidden': 'true' }));
    attachView(view);
    const top = h('div', { class: 'sp-top' },
      h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Close', onclick: () => { stopRecording(); location.hash = '#/'; } }, ic('close', 22, 2.4)),
      mode === 'story'
        ? h('button', { type: 'button', class: 'sp-icon', 'aria-label': flash ? 'Flash on' : 'Flash off', 'aria-pressed': String(flash), onclick: () => { flash = !flash; applyTorch(); draw(); focusLater('.sp-top button[aria-pressed]'); } }, ic('bolt', 22, 2))
        : h('span'));
    const rail = h('div', { class: 'sp-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
      h('button', { type: 'button', class: 'sp-icon sp-aa', 'aria-label': 'Text', disabled: isRec ? '' : null, onclick: () => setMode('text') }, 'Aa'),
      h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Draw', disabled: isRec ? '' : null, onclick: drawingStory }, ic('edit', 20, 2)),
      moreButton(),
      moreOpen ? h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Hands-free', 'aria-pressed': String(handsFree), disabled: isRec ? '' : null, onclick: () => { handsFree = !handsFree; draw(); focusLater('.sp-rail button[aria-label="Hands-free"]'); } }, ic('hand', 20, 2)) : null,
      moreOpen ? h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Timer', 'aria-pressed': String(timerOn), disabled: isRec ? '' : null, onclick: () => { timerOn = !timerOn; draw(); focusLater('.sp-rail button[aria-label="Timer"]'); } }, ic('timer', 20, 2)) : null);
    const shutter = h('button', { type: 'button', class: `sp-shutter${isRec ? ' rec' : ''}${isRec && locked ? ' locked' : ''}`, 'aria-label': shutterLabel(), disabled: mode === 'text' && !typed.trim() ? '' : null },
      h('span', { class: 'sp-shutter-dot' }, mode === 'voice' && !isRec ? ic('mic', 26, 2.2) : mode === 'text' ? ic('check', 28, 2.6) : null));
    attachShutter(shutter);
    const wrap = h('div', { class: 'sp-shutter-wrap' }, mode !== 'text' ? ring(type) : null, shutter,
      h('span', { class: 'sp-time', 'aria-hidden': 'true' }, isRec ? clock(elapsed) : ''),
      h('span', { class: `sp-lock${isRec && locked ? ' show on' : ''}`, 'aria-hidden': 'true' }, ic('lock', 18, 2.2)));
    const pick = h('label', { class: 'sp-pick', style: lastThumb ? `background-image:url("${lastThumb}")` : null }, lastThumb ? null : ic('image', 22, 2),
      h('input', { type: 'file', id: 'sp-file', class: 'sr', accept: mode === 'voice' ? 'image/*' : 'image/*,video/*', 'aria-label': mode === 'voice' ? 'Choose a photo from your phone' : 'Choose from your phone', disabled: isRec ? '' : null, onchange: (e) => pickFile(e.target.files?.[0]) }));
    const flip = mode === 'story' ? h('button', { type: 'button', class: 'sp-icon sp-flip', 'aria-label': 'Switch camera', disabled: isRec ? '' : null, onclick: flipCamera }, ic('repeat', 22, 2)) : h('span');
    const modes = h('div', { class: 'sp-modes', role: 'radiogroup', 'aria-label': 'What to post' }, MODES.map((m) => h('button', {
      type: 'button', class: 'sp-mode', role: 'radio', 'aria-checked': String(m === mode), tabindex: m === mode ? '0' : '-1', disabled: isRec ? '' : null,
      onclick: () => setMode(m),
      onkeydown: (e) => {
        const i = MODES.indexOf(mode);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setMode(MODES[(i + 1) % 3]); focusMode(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setMode(MODES[(i + 2) % 3]); focusMode(); }
      },
    }, m.toUpperCase())));
    attachView(modes, { buttons: true });
    const chip = (value, label) => h('button', { type: 'button', class: 'sp-chip', 'data-zoom': String(value), 'aria-label': label, 'aria-pressed': String(chipOn(value)), disabled: isRec ? '' : null, onclick: () => setLens(value < 1 ? 'ultra' : 'main') }, formatZoom(value));
    const wideValue = ultraWide === 'zoom' ? zoomCaps.min : 0.5;
    const chips = mode === 'story' && stream ? h('div', { class: 'sp-zoom-chips', role: 'group', 'aria-label': 'Zoom' }, ultraWide ? chip(wideValue, `Zoom ${formatZoom(wideValue)}, the wide lens`) : null, chip(1, 'Zoom 1x')) : null;
    const bottom = h('div', { class: 'sp-bottom' }, chips, h('div', { class: 'sp-controls' }, mode === 'text' ? h('span') : pick, wrap, flip), modes);
    return [heading(), mode !== 'text' ? partsBar(type) : null, view, top, rail, bottom, busy ? h('div', { class: 'sp-status', role: 'status' }, busy) : null, errorEl(), live];
  }

  function previewScreen() {
    const d = draft;
    const frame = h('div', { class: 'sp-frame', style: `background:linear-gradient(160deg, ${d.colours[0]}, ${d.colours[1]})`, 'data-layers': String(overlay.layers.length), 'data-strokes': String(overlay.strokes.length) });
    if (!mediaEl) mediaEl = makeMedia(d);
    if (mediaEl) frame.append(mediaEl);
    if (d.kind === 'audio') frame.append(voiceMark());
    if (!drawCanvas) {
      drawCanvas = h('canvas', { class: 'sp-draw', 'aria-hidden': 'true' });
      attachCanvas(drawCanvas);
      observer?.disconnect();
      observer = new ResizeObserver(() => fitCanvas());
      observer.observe(drawCanvas);
      document.fonts?.ready?.then(() => paintOverlay());
    }
    drawCanvas.classList.toggle('pen', tool === 'pen');
    frame.append(drawCanvas);
    if (editing) {
      const ta = h('textarea', { class: 'sp-edit-input', 'aria-label': 'Your words', maxlength: String(MAX_TEXT), rows: '3', style: `color:${editing.colour}`, oninput: (e) => { editing.text = e.target.value; }, onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); finishText(); } } }, editing.text);
      frame.append(h('div', { class: 'sp-editor', role: 'group', 'aria-label': 'Words' }, swatches(editing.colour, (c) => { editing.colour = c; ta.style.color = c; }, 'Text colour'), ta,
        h('button', { type: 'button', class: 'sp-icon sp-done', 'aria-label': 'Done', onclick: finishText }, ic('check', 26, 2.6))));
    }
    requestAnimationFrame(fitCanvas);
    const top = h('div', { class: 'sp-top' },
      h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Discard', disabled: busy ? '' : null, onclick: () => { if (editing) { finishText(); return; } confirmOpen = true; draw(); focusLater('.sp-dialog .plain'); } }, ic('close', 22, 2.4)),
      tool === 'pen'
        ? h('div', { class: 'sp-top-tools' },
          h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Undo', disabled: overlay.strokes.length ? null : '', onclick: undo }, ic('undo', 22, 2.2)),
          h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Done', onclick: () => { tool = null; draw(); focusLater('.sp-rail button[aria-label="Draw"]'); } }, ic('check', 24, 2.6)))
        : h('span'));
    const rail = editing ? null : h('div', { class: 'sp-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
      h('button', { type: 'button', class: 'sp-icon sp-aa', 'aria-label': 'Text', disabled: busy ? '' : null, onclick: () => startText(null) }, 'Aa'),
      h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Draw', 'aria-pressed': String(tool === 'pen'), disabled: busy ? '' : null, onclick: () => { tool = tool === 'pen' ? null : 'pen'; draw(); focusLater('.sp-rail button[aria-label="Draw"]'); } }, ic('edit', 20, 2)),
      moreButton(),
      moreOpen ? h('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Background colour', disabled: busy ? '' : null, onclick: () => { d.colours = nextColours(d.colours); colours = d.colours; draw(); focusLater('.sp-rail button[aria-label="Background colour"]'); } }, ic('palette', 20, 2)) : null);
    const palette = tool === 'pen' && !editing ? swatches(penColour, (c) => { penColour = c; }, 'Pen colour') : null;
    const actions = editing ? null : h('div', { class: 'sp-bottom sp-actions' },
      h('button', { type: 'button', class: 'sp-icon sp-save', 'aria-label': 'Save to your phone', disabled: busy ? '' : null, onclick: saveToPhone }, ic('download', 22, 2)),
      h('button', { type: 'button', class: 'sp-share', disabled: busy ? '' : null, onclick: post }, avatarEl({ photo: session.photo, name: session.displayName || session.name, email: session.email }, 32), 'Your story'));
    const dialog = confirmOpen ? h('div', { class: 'sp-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sp-confirm-h', onkeydown: (e) => { if (e.key === 'Escape') { confirmOpen = false; draw(); focusLater('button[aria-label="Discard"]'); } } },
      h('p', { id: 'sp-confirm-h' }, 'Discard this story?'),
      h('button', { type: 'button', class: 'danger', onclick: discard }, 'Discard'),
      h('button', { type: 'button', class: 'plain', onclick: () => { confirmOpen = false; draw(); focusLater('button[aria-label="Discard"]'); } }, 'Keep')) : null;
    const busyEl = busy ? h('div', { class: 'sp-busy', role: 'status' }, h('div', { class: 'sp-progress', 'aria-hidden': 'true' }, h('span')), h('span', { class: 'sp-busy-text' }, busy)) : null;
    return [heading(), d.kind === 'video' || d.kind === 'audio' ? partsBar(d.kind, { done: true }) : null, frame, top, rail, palette, layerList(), actions,
      d.note && !busy ? h('p', { class: 'sp-note' }, d.note) : null, dialog, busyEl, toast ? h('div', { class: 'sp-status', role: 'status' }, toast) : null, errorEl(), live];
  }

  const notPoster = () => [h('div', { class: 'sp-notposter' },
    h('header', { class: 'cr-head' }, h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Back to Home', onclick: () => { location.hash = '#/'; } }, ic('back', 20, 2.2)), h('h1', { id: 'page-title', tabindex: '-1' }, 'Post a story')),
    h('section', { class: 'card' },
      h('h2', { class: 'big' }, session?.email ? 'Not set up for stories' : 'Staff only'),
      h('p', { class: 'muted' }, session?.email ? 'Ask an admin to turn on "Can post stories" for you on the staff list.' : 'Sign in with Google on Account first.'),
      h('a', { class: 'link', href: '#/account' }, 'Account')))];

  function draw() {
    if (closed) return;
    host.dataset.stage = stage;
    host.dataset.mode = mode;
    if (!session?.postStories) { fill(host, notPoster()); return; }
    fill(host, stage === 'preview' && draft ? previewScreen() : cameraScreen());
    // Media put back on the page after a redraw carries on playing.
    if (stage === 'camera' && camEl?.srcObject) camEl.play?.().catch(() => {});
    if (stage === 'preview' && mediaEl?.tagName === 'VIDEO') mediaEl.play().catch(() => {});
    if (stage === 'preview' && playing && audioEl) audioEl.play().catch(() => {});
  }

  let first = true;
  const stop = onSession((next) => {
    const changed = first || next?.postStories !== session?.postStories || next?.email !== session?.email;
    first = false;
    session = next;
    if (!changed) return;
    if (session?.postStories && stage === 'camera') openMedia(); else draw();
  });
  return () => {
    closed = true;
    stop();
    if (rec?.timer) clearInterval(rec.timer);
    rec = null;
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* fine */ } }
    recorder = null;
    stopTracks(); // the camera, the microphone and the recording canvas
    observer?.disconnect();
    clearTimeout(toastTimer);
    clearTimeout(zoomTimer);
    clearTimeout(focusTimer);
    if (draft?.url) URL.revokeObjectURL(draft.url);
    if (voicePhoto?.url) URL.revokeObjectURL(voicePhoto.url);
    if (lastThumb) URL.revokeObjectURL(lastThumb);
    if (local) delete window.__storyEditor;
  };
}

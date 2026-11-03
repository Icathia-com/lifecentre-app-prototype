// Post a story (people with "Can post stories", and admins): take a photo or video with the camera, pick one from the phone,
// record a voice message over a colour or a photo, or write a text story on a colour. Text can go over photos and videos.
// Recording video or voice just runs: the app splits it into consecutive 30-second parts as it goes (shown building up
// along the bottom) and stops by itself at the limit (6 parts of video, 10 of voice). A picked video or audio is split the
// same way. One file is kept per recording and watched in parts. Files are made smaller on the phone and anything over
// 60 MB is refused.
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { uploadFile, shrinkPhoto, MAX_UPLOAD_BYTES, TOO_BIG } from '../uploads.js';
import { PART_SECONDS, PART_LIMITS, PALETTE, MAX_TEXT, DAY, splitParts, partsFor, shownSeconds, maxSeconds, clock } from '../stories.js';

// Shorter parts while testing against the local emulators (?partSeconds=2); 30 seconds everywhere else.
const params = new URLSearchParams(location.search);
const local = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('emulator');
export const PART = (local && Number(params.get('partSeconds'))) || PART_SECONDS;

const MIMES = {
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'],
};
const pickMime = (kind) => MIMES[kind].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
const EXT_TYPE = { webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', weba: 'audio/webm' };
const REENCODE_OVER = 15 * 1024 * 1024; // a picked video bigger than this (or taller than 720p) is re-encoded on the phone when the browser can

// Reads a media file's length in seconds (and a video's height).
function probe(file, kind) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.onloadedmetadata = () => { const out = { duration: el.duration, height: el.videoHeight || 0 }; URL.revokeObjectURL(url); resolve(out); };
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

export function render(root) {
  let session = null;
  let step = 'choose'; // choose | camera | voice | text | edit | posting
  let kind = null;     // photo | video | audio | text
  let stream = null;
  let recorder = null;
  let rec = null;      // { t0, chunks, timer, mime } while recording
  let elapsed = 0;     // seconds recorded so far
  let draft = null;    // { kind, blob, mimeType, duration, parts, preview, text, colours, bgBlob, bgPreview }
  let cameraMode = 'photo';
  let facing = 'user';
  let error = '';
  let busy = '';
  let colours = PALETTE[0];
  const host = h('div', { class: 'stack st-post' });
  root.append(host);

  const header = (title, back = () => goChoose()) => h('header', { class: 'cr-head' },
    h('button', { type: 'button', class: 'round-btn', 'aria-label': step === 'choose' ? 'Back to Home' : 'Back', onclick: step === 'choose' ? () => { location.hash = '#/'; } : back }, ic('back', 20, 2.2)),
    h('h1', { id: 'page-title', tabindex: '-1' }, title));
  const say = (text) => { error = text; draw(); };

  async function stopStream() {
    if (rec?.timer) clearInterval(rec.timer);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* fine */ } }
    recorder = null; rec = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  function goChoose() { stopStream(); step = 'choose'; kind = null; draft = null; error = ''; draw(); }

  // ---- Camera (photo or video) and voice ----
  async function openCamera() {
    error = ''; step = 'camera'; kind = cameraMode === 'photo' ? 'photo' : 'video'; draw();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    } catch { say('The camera could not be opened. Check the app may use the camera and microphone, or pick a photo or video from your phone.'); step = 'choose'; draw(); return; }
    draw();
  }
  async function openVoice() {
    error = ''; step = 'voice'; kind = 'audio'; draw();
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { say('The microphone could not be opened. Check the app may use it.'); step = 'choose'; draw(); return; }
    draw();
  }
  async function flipCamera() { facing = facing === 'user' ? 'environment' : 'user'; stream?.getTracks().forEach((t) => t.stop()); stream = null; await openCamera(); }

  function takePhoto() {
    const video = host.querySelector('video.st-cam');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); } // the preview is mirrored; so is the photo
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (!blob) return; stopStream(); setDraft({ kind: 'photo', blob, mimeType: 'image/jpeg', duration: shownSeconds('photo', 0), parts: partsFor('photo', 0) }); }, 'image/jpeg', 0.86);
  }

  // One continuous recording; the parts are worked out from the time that has run.
  function startRecording(type) {
    const mime = pickMime(type);
    if (!window.MediaRecorder) { say('This browser cannot record. Pick a file from your phone instead.'); return; }
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime || undefined, ...(type === 'video' ? { videoBitsPerSecond: 2500000, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 96000 }) });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const duration = Math.max(1, Math.round(elapsed));
      const blob = new Blob(chunks, { type: recorder?.mimeType || mime });
      stream?.getTracks().forEach((t) => t.stop()); stream = null; recorder = null;
      setDraft({ kind: type, blob, mimeType: blob.type, duration, parts: splitParts(Math.min(duration, limitSeconds(type)), { partSeconds: PART, maxParts: PART_LIMITS[type] }) });
    };
    elapsed = 0;
    const t0 = performance.now();
    rec = { t0, mime, timer: setInterval(() => {
      elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= limitSeconds(type)) { elapsed = limitSeconds(type); stopRecording(); return; }
      paintRecording();
    }, 200) };
    recorder.start(1000);
    draw();
  }
  const limitSeconds = (type) => PART_LIMITS[type] * PART;
  function stopRecording() {
    if (!rec) return;
    clearInterval(rec.timer); rec = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    draw();
  }
  const recording = () => !!rec;

  // The parts bar along the bottom of the recording screen: one segment per part so far, the last one growing.
  function partsBar(type) {
    const bar = h('div', { class: 'st-parts', role: 'progressbar', 'aria-label': 'Recording', 'aria-valuemin': '0', 'aria-valuemax': String(limitSeconds(type)), 'aria-valuenow': String(Math.floor(elapsed)) });
    const parts = recording() || elapsed > 0 ? splitParts(elapsed, { partSeconds: PART, maxParts: PART_LIMITS[type] }) : [];
    for (let k = 0; k < PART_LIMITS[type]; k++) {
      const p = parts[k];
      const seg = h('span', { class: `st-part${p ? ' on' : ''}` }, p ? h('span', { class: 'st-part-fill', style: `width:${Math.round(((p.end - p.start) / PART) * 100)}%` }) : null);
      bar.append(seg);
    }
    return bar;
  }
  const recLabel = (type) => `${clock(elapsed)} · part ${Math.min(PART_LIMITS[type], Math.max(1, Math.ceil(elapsed / PART) || 1))} of up to ${PART_LIMITS[type]}`;
  function paintRecording() {
    const bar = host.querySelector('.st-parts');
    if (bar) bar.replaceWith(partsBar(kind));
    const label = host.querySelector('.st-rec-time');
    if (label) label.textContent = recLabel(kind);
  }

  // ---- From the phone ----
  async function pickFile(file) {
    if (!file) return;
    error = '';
    if (file.size > MAX_UPLOAD_BYTES) { say(TOO_BIG); return; }
    try {
      if (file.type.startsWith('image/')) {
        busy = 'Preparing the photo…'; draw();
        setDraft({ kind: 'photo', blob: await shrinkPhoto(file, { max: 1080 }), mimeType: 'image/jpeg', duration: shownSeconds('photo', 0), parts: partsFor('photo', 0) });
      } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const type = file.type.startsWith('video/') ? 'video' : 'audio';
        busy = 'Reading the file…'; draw();
        const { duration, height } = await probe(file, type);
        let blob = file; let mimeType = file.type; let length = duration;
        if (type === 'video' && canReencode() && (file.size > REENCODE_OVER || height > 720)) {
          busy = 'Making the video smaller… 0%'; draw();
          const out = await reencode(file, { maxSeconds: maxSeconds('video'), onProgress: (f) => { busy = `Making the video smaller… ${Math.round(f * 100)}%`; const b = host.querySelector('.st-busy'); if (b) b.textContent = busy; } });
          blob = out.blob; mimeType = out.mimeType; length = out.duration;
        }
        const shown = Math.min(Math.round(length), maxSeconds(type));
        setDraft({ kind: type, blob, mimeType, duration: Math.max(1, shown), parts: splitParts(shown, { partSeconds: PART, maxParts: PART_LIMITS[type] }), note: length > maxSeconds(type) ? `Only the first ${type === 'video' ? '3 minutes' : '5 minutes'} will be shown.` : '' });
      } else say('Pick a photo, a video or an audio file.');
    } catch (e) { busy = ''; say(e.message || 'That file could not be used.'); }
  }

  // ---- The draft, then posting ----
  function setDraft(d) {
    busy = '';
    if (draft?.preview) URL.revokeObjectURL(draft.preview);
    draft = { text: '', colours, bgBlob: null, bgPreview: '', ...d, preview: URL.createObjectURL(d.blob) };
    kind = d.kind; step = 'edit'; error = '';
    draw();
  }
  function textDraft() { kind = 'text'; draft = { kind: 'text', text: '', colours, duration: shownSeconds('text', 0), parts: partsFor('text', 0) }; step = 'edit'; error = ''; draw(); }
  function pickBackground(file) {
    if (!file || !draft) return;
    shrinkPhoto(file, { max: 1080 }).then((blob) => { if (draft.bgPreview) URL.revokeObjectURL(draft.bgPreview); draft.bgBlob = blob; draft.bgPreview = URL.createObjectURL(blob); draw(); }).catch((e) => say(e.message));
  }

  async function post() {
    if (!draft || busy) return;
    const text = (draft.text || '').trim();
    if (draft.kind === 'text' && !text) { say('Write something first.'); return; }
    if (text.length > MAX_TEXT) { say(`Keep the text to ${MAX_TEXT} characters.`); return; }
    step = 'posting'; busy = 'Posting…'; error = ''; draw();
    try {
      const values = {
        author: session.email, authorName: session.displayName || session.name || session.email, authorPhoto: session.photo || undefined,
        type: draft.kind, colours: draft.colours, duration: draft.duration, parts: draft.parts, expiresAt: Date.now() + DAY, text: text || undefined,
      };
      if (draft.blob) { busy = 'Uploading…'; draw(); values.mediaUrl = await uploadFile(draft.blob, { kind: 'stories' }); values.mediaType = draft.mimeType || draft.blob.type; }
      if (draft.bgBlob) values.bgImage = await uploadFile(draft.bgBlob, { kind: 'stories' });
      await data.admin.save('stories', session.email, values);
      busy = '';
      location.hash = '#/';
    } catch (e) {
      step = 'edit'; busy = '';
      say(e.code === 'permission-denied' ? 'This account is not allowed to post stories.' : (e.message || 'Could not post. Please try again.'));
    }
  }

  // ---- Screens ----
  const swatches = (picked, onPick) => h('div', { class: 'st-swatches', role: 'group', 'aria-label': 'Background colour' },
    PALETTE.map(([a, b], k) => h('button', { type: 'button', class: `st-swatch${picked[0] === a ? ' on' : ''}`, 'aria-label': `Colour ${k + 1}`, 'aria-pressed': String(picked[0] === a), style: `background:linear-gradient(135deg,${a},${b})`, onclick: () => onPick([a, b]) })));
  const fileInput = (id, accept, onPick, capture) => h('input', { type: 'file', id, class: 'sr', accept, capture, onchange: (e) => onPick(e.target.files?.[0]) });

  function chooseScreen() {
    const pick = fileInput('st-file', 'image/*,video/*,audio/*', pickFile);
    return [header('Post a story'),
      h('p', { class: 'muted st-intro' }, 'Everyone can watch it on Home for 24 hours.'),
      h('div', { class: 'st-options' },
        h('button', { type: 'button', class: 'st-opt', onclick: () => { cameraMode = 'photo'; openCamera(); } }, ic('image', 26, 1.8), h('b', {}, 'Camera'), h('small', {}, 'Take a photo or record a video')),
        h('label', { class: 'st-opt', for: 'st-file' }, ic('doc', 26, 1.8), h('b', {}, 'From your phone'), h('small', {}, 'A photo, video or audio file'), pick),
        h('button', { type: 'button', class: 'st-opt', onclick: openVoice }, ic('mic', 26, 1.8), h('b', {}, 'Voice'), h('small', {}, 'Record over a colour or a photo')),
        h('button', { type: 'button', class: 'st-opt', onclick: textDraft }, ic('edit', 26, 1.8), h('b', {}, 'Text'), h('small', {}, 'Words on a colour'))),
      busy ? h('p', { class: 'note st-busy', role: 'status' }, busy) : null,
      error ? h('p', { class: 'error', role: 'alert' }, error) : null];
  }

  function cameraScreen() {
    const video = h('video', { class: `st-cam${facing === 'user' ? ' mirror' : ''}`, autoplay: '', muted: '', playsinline: '' });
    if (stream) video.srcObject = stream;
    const isVideo = cameraMode === 'video';
    return [header(isVideo ? 'Record a video' : 'Take a photo'),
      h('div', { class: 'st-camera' }, video,
        h('div', { class: 'st-cam-top' },
          h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Camera mode' },
            h('button', { type: 'button', role: 'tab', 'aria-selected': String(!isVideo), disabled: recording() ? '' : null, onclick: () => { cameraMode = 'photo'; kind = 'photo'; draw(); } }, 'Photo'),
            h('button', { type: 'button', role: 'tab', 'aria-selected': String(isVideo), disabled: recording() ? '' : null, onclick: () => { cameraMode = 'video'; kind = 'video'; draw(); } }, 'Video')),
          h('button', { type: 'button', class: 'wt-top-btn', 'aria-label': 'Switch camera', disabled: recording() ? '' : null, onclick: flipCamera }, ic('repeat', 20, 2))),
        h('div', { class: 'st-cam-bottom' },
          isVideo ? partsBar('video') : null,
          isVideo ? h('p', { class: 'st-rec-time', 'aria-live': 'off' }, recording() ? recLabel('video') : `Up to ${PART_LIMITS.video} parts of ${PART} seconds`) : null,
          isVideo
            ? h('button', { type: 'button', class: `st-rec${recording() ? ' on' : ''}`, 'aria-label': recording() ? 'Stop recording' : 'Start recording', onclick: () => (recording() ? stopRecording() : startRecording('video')) }, h('span', { class: 'st-rec-dot' }))
            : h('button', { type: 'button', class: 'st-rec photo', 'aria-label': 'Take the photo', onclick: takePhoto }, h('span', { class: 'st-rec-dot' })))),
      error ? h('p', { class: 'error', role: 'alert' }, error) : null];
  }

  function voiceScreen() {
    return [header('Record a voice message'),
      h('div', { class: 'st-voice-screen', style: `background:linear-gradient(160deg,${colours[0]},${colours[1]})` },
        h('div', { class: 'st-voice-mic', 'aria-hidden': 'true' }, ic('mic', 48, 1.6)),
        h('div', { class: 'st-cam-bottom' },
          partsBar('audio'),
          h('p', { class: 'st-rec-time' }, recording() ? recLabel('audio') : `Up to ${PART_LIMITS.audio} parts of ${PART} seconds`),
          h('button', { type: 'button', class: `st-rec${recording() ? ' on' : ''}`, 'aria-label': recording() ? 'Stop recording' : 'Start recording', onclick: () => (recording() ? stopRecording() : startRecording('audio')) }, h('span', { class: 'st-rec-dot' })))),
      h('p', { class: 'muted' }, 'Background colour (or add a photo after recording):'),
      swatches(colours, (c) => { colours = c; draw(); }),
      error ? h('p', { class: 'error', role: 'alert' }, error) : null];
  }

  function editScreen() {
    const d = draft;
    const bg = `linear-gradient(160deg,${d.colours[0]},${d.colours[1]})`;
    let preview;
    if (d.kind === 'photo') preview = h('img', { class: 'st-prev-media', src: d.preview, alt: 'Your photo' });
    else if (d.kind === 'video') preview = h('video', { class: 'st-prev-media', src: d.preview, controls: '', playsinline: '' });
    else if (d.kind === 'audio') preview = h('div', { class: 'st-prev-audio' }, d.bgPreview ? h('img', { class: 'st-prev-media', src: d.bgPreview, alt: '' }) : null, h('div', { class: 'st-voice', 'aria-hidden': 'true' }, ic('mic', 44, 1.8), h('span', {}, 'Voice')), h('audio', { src: d.preview, controls: '' }));
    else preview = h('div', { class: 'st-textstory st-prev-text' }, d.text || 'Your words here');
    const textOverlay = d.kind !== 'text' && d.text ? h('p', { class: 'st-text st-prev-overlay' }, d.text) : null;
    const bgPick = d.kind === 'audio' ? fileInput('st-bg', 'image/*', pickBackground) : null;
    return [header(d.kind === 'text' ? 'Text story' : 'Your story', () => { if (d.kind === 'photo' || d.kind === 'video') openCamera(); else if (d.kind === 'audio') openVoice(); else goChoose(); }),
      h('div', { class: 'st-preview', style: bg }, preview, textOverlay),
      d.note ? h('p', { class: 'note' }, d.note) : null,
      d.kind !== 'text' ? h('p', { class: 'muted' }, `${d.parts.length} ${d.parts.length === 1 ? 'part' : 'parts'} · ${clock(d.duration)}`) : null,
      h('div', { class: 'field' },
        h('label', { for: 'st-caption' }, d.kind === 'text' ? 'Your words' : 'Add text (optional)'),
        h('textarea', { id: 'st-caption', maxlength: String(MAX_TEXT), rows: d.kind === 'text' ? '4' : '2', placeholder: d.kind === 'text' ? 'What would you like to say?' : 'A line over the picture', oninput: (e) => { d.text = e.target.value; const over = host.querySelector('.st-prev-overlay, .st-prev-text'); if (over) over.textContent = d.text || (d.kind === 'text' ? 'Your words here' : ''); } }, d.text)),
      d.kind === 'text' || d.kind === 'audio' ? swatches(d.colours, (c) => { d.colours = c; colours = c; draw(); }) : null,
      d.kind === 'audio' ? h('div', { class: 'form-actions' }, h('label', { class: 'btn', for: 'st-bg' }, ic('image', 16, 2), d.bgPreview ? 'Change the photo' : 'Photo background'), bgPick) : null,
      error ? h('p', { class: 'error', role: 'alert' }, error) : null,
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn primary st-post-btn', disabled: busy ? '' : null, onclick: post }, 'Post'),
        h('button', { type: 'button', class: 'btn', onclick: goChoose }, 'Start again'))];
  }

  const postingScreen = () => [header('Posting'), h('p', { class: 'note st-busy', role: 'status' }, busy || 'Posting…')];

  function draw() {
    if (!session?.postStories) {
      fill(host, header('Post a story'), h('section', { class: 'card' },
        h('h2', { class: 'big' }, session?.email ? 'Not set up for stories' : 'Staff only'),
        h('p', { class: 'muted' }, session?.email ? 'Ask an admin to turn on "Can post stories" for you on the staff list.' : 'Sign in with Google on Account first.'),
        h('a', { class: 'link', href: '#/account' }, 'Account')));
      return;
    }
    const screen = step === 'camera' ? cameraScreen() : step === 'voice' ? voiceScreen() : step === 'edit' ? editScreen() : step === 'posting' ? postingScreen() : chooseScreen();
    fill(host, screen);
  }

  let first = true;
  const stop = onSession((next) => {
    const changed = first || next?.postStories !== session?.postStories || next?.email !== session?.email;
    first = false;
    session = next;
    if (changed) draw();
  });
  return () => { stop(); stopStream(); if (draft?.preview) URL.revokeObjectURL(draft.preview); };
}

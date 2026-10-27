// The event page (design/Event-Detail.dc.html): cover, host, when, Register / Contact / More, location, about, who's going.
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { h, fill, icon, safeUrl, formatClock, minutesOfDay, googleCalendarUrl, icsDataUrl } from '../util.js';
import { TYPES, SITES, CHURCH, siteName, siteVenue, siteAddress, hexToRgba } from '../sites.js';
import { ic, coverEl, coverOf, hostDot, eventTime, longDate } from '../ui.js';
import { makePoster } from '../poster.js';

const FACES = [['SJ', '#2459E6'], ['AR', '#D32A25'], ['KD', '#2E7D5B'], ['MT', '#9A6200'], ['PL', '#6B4FA8']];
const QR_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

// The QR library is only fetched when someone opens the QR code.
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_SCRIPT;
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => reject(new Error('Could not load the QR code maker'));
    document.head.append(s);
  });
}

function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return icon(`<svg role="img" aria-label="QR code for this event" viewBox="0 0 ${n + 8} ${n + 8}" width="220" height="220" shape-rendering="crispEdges"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#0B1220"/></svg>`);
}

export function render(root, { id }) {
  const app = document.querySelector('.app');
  const body = h('div', { class: 'stack' });
  const toast = h('p', { class: 'toast', role: 'status', hidden: '' });
  let toastTimer;
  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  };
  let isEditor = false;
  const applyEditor = () => { for (const el of body.querySelectorAll('[data-editor]')) el.toggleAttribute('hidden', !isEditor); };
  const stopSession = onSession((session) => { isEditor = ['admin', 'staff'].includes(session?.role); applyEditor(); });

  const sheetHost = h('div');
  root.append(body);
  app.append(toast, sheetHost);
  body.append(h('p', { class: 'note', role: 'status' }, 'Loading…'));

  data.getEvent(id).then(({ value: ev, source }) => {
    if (!ev) {
      body.replaceChildren(
        h('header', { class: 'loc-top' }, h('a', { class: 'round-btn', href: '#/events', 'aria-label': 'Back to Events' }, ic('back', 20, 2.2))),
        h('section', { class: 'card' }, h('h1', { id: 'page-title', tabindex: '-1', class: 'big' }, 'This event isn’t available'), h('a', { class: 'link', href: '#/events' }, 'See all events')));
      return;
    }
    draw(ev, source);
  });

  function draw(ev, source) {
    const cover = coverOf(ev);
    const url = `${location.origin}${location.pathname}#/events/${encodeURIComponent(ev.id)}`;
    const venue = siteVenue(ev.location, ev.place);
    const address = siteAddress(ev.location);
    const regUrl = safeUrl(ev.registerUrl);
    document.title = `${ev.title} · Life Centre`;
    app.style.background = `linear-gradient(180deg, ${hexToRgba(cover.from, 0.95)} 0px, ${hexToRgba(cover.to, 0.55)} 240px, rgba(243,243,245,0) 520px), linear-gradient(180deg, #D8E0E8 0px, #EEF0F3 520px, #F3F3F5 100%)`;

    const calEvent = { id: ev.id, title: ev.title, start: ev.start, end: ev.end, location: [venue, address].filter(Boolean).join(', '), description: ev.description };
    let menuOpen = false;
    let sheet = null; // 'contact' | 'qr' | 'calendar'

    const menu = h('div', { class: 'more-menu', role: 'menu', hidden: '' },
      h('a', { role: 'menuitem', href: `#/events/${encodeURIComponent(ev.id)}/edit`, 'data-editor': '', hidden: isEditor ? null : '' }, 'Edit event', ic('edit', 18)),
      h('span', { class: 'sep', 'aria-hidden': 'true', 'data-editor': '', hidden: isEditor ? null : '' }),
      h('button', { type: 'button', role: 'menuitem', onclick: () => openSheet('calendar') }, 'Add to calendar', ic('calendar', 18)),
      h('button', { type: 'button', role: 'menuitem', onclick: shareLink }, 'Share event link', ic('link', 18)),
      h('button', { type: 'button', role: 'menuitem', onclick: sharePoster }, 'Share event poster', ic('image', 18)),
      h('button', { type: 'button', role: 'menuitem', onclick: () => openSheet('qr') }, 'Event QR code', ic('qr', 18)));
    const moreBtn = h('button', { type: 'button', class: 'act', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => setMenu(!menuOpen) }, ic('dots', 20), h('span', {}, 'More'));
    const shareBtn = h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Share event', onclick: () => setMenu(!menuOpen) }, ic('share', 20));
    function setMenu(open) {
      menuOpen = open;
      menu.hidden = !open;
      moreBtn.setAttribute('aria-expanded', String(open));
      if (open) requestAnimationFrame(() => menu.scrollIntoView({ block: 'center', behavior: 'smooth' })); // keep it clear of the tab bar
    }

    async function shareLink() {
      setMenu(false);
      try {
        if (navigator.share) await navigator.share({ title: ev.title, url });
        else { await navigator.clipboard.writeText(url); say('Event link copied'); }
      } catch (e) { if (e.name !== 'AbortError') say('Could not share the link'); }
    }

    async function sharePoster() {
      setMenu(false);
      try {
        const blob = await makePoster(ev);
        const file = new File([blob], `${ev.title}.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: ev.title });
        else {
          const a = h('a', { href: URL.createObjectURL(blob), download: `${ev.title}.png` });
          document.body.append(a);
          a.click();
          a.remove();
          say('Poster saved');
        }
      } catch (e) { if (e.name !== 'AbortError') say('Could not make the poster'); }
    }

    function openSheet(name) {
      setMenu(false);
      sheet = name;
      drawSheet();
    }
    const closeSheet = () => { sheet = null; drawSheet(); };

    function drawSheet() {
      if (!sheet) { sheetHost.replaceChildren(); return; }
      const titles = { contact: ['Contact the organiser', ev.host || CHURCH.name], qr: ['Event QR code', ev.title], calendar: ['Add to calendar', ev.title] };
      const rows = [];
      if (sheet === 'contact') {
        rows.push(h('a', { class: 'sheet-row', href: `mailto:${CHURCH.email}?subject=${encodeURIComponent(`About: ${ev.title}`)}` }, ic('mail', 22), h('span', {}, h('b', {}, 'Email'), h('small', {}, CHURCH.email))));
        if (CHURCH.whatsapp) rows.push(h('a', { class: 'sheet-row', href: `https://wa.me/${CHURCH.whatsapp.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener' }, ic('chat', 22), h('span', {}, h('b', {}, 'WhatsApp'), h('small', {}, CHURCH.whatsapp))));
        if (CHURCH.phone) rows.push(h('a', { class: 'sheet-row', href: `tel:${CHURCH.phone.replace(/[^\d+]/g, '')}` }, ic('phone', 22), h('span', {}, h('b', {}, 'Call the office'), h('small', {}, CHURCH.phone))));
      } else if (sheet === 'calendar') {
        rows.push(h('a', { class: 'sheet-row', href: googleCalendarUrl(calEvent), target: '_blank', rel: 'noopener' }, ic('calendar', 22), h('span', {}, h('b', {}, 'Google Calendar'))));
        rows.push(h('a', { class: 'sheet-row', href: icsDataUrl(calEvent), download: `${ev.title}.ics` }, ic('calendar', 22), h('span', {}, h('b', {}, 'Apple / Outlook'), h('small', {}, 'Downloads a calendar file'))));
      } else {
        const holder = h('div', { class: 'qr-box' }, h('small', {}, 'Making the code…'));
        rows.push(holder);
        loadQr().then((qrcode) => holder.replaceChildren(qrSvg(qrcode, url))).catch((e) => holder.replaceChildren(h('small', {}, e.message)));
      }
      const [title, sub] = titles[sheet];
      const close = h('button', { type: 'button', class: 'sheet-done', onclick: closeSheet }, 'Done');
      sheetHost.replaceChildren(h('div', { class: 'sheet-wrap', onkeydown: (e) => { if (e.key === 'Escape') closeSheet(); } },
        h('button', { type: 'button', class: 'sheet-back', 'aria-label': 'Close', onclick: closeSheet }),
        h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('span', { class: 'grab', 'aria-hidden': 'true' }),
          h('h2', {}, title), h('p', { class: 'muted' }, sub),
          ...rows, close)));
      close.focus();
    }

    const when = `${longDate(ev.start)} · ${eventTime(ev)}${ev.end ? ` to ${formatClock(minutesOfDay(ev.end))}` : ''}`;
    const chips = [TYPES[ev.type], siteName(ev.location, ev.place), ev.price ? `S$${ev.price}` : null, ev.requireApproval ? 'Approval needed' : null, ev.capacity ? `Capacity ${ev.capacity}` : null, ev.sample ? 'Sample' : null].filter(Boolean);

    const mapArt = h('div', { class: 'map-art', 'aria-hidden': 'true' },
      icon('<svg viewBox="0 0 350 130" width="100%" height="130" preserveAspectRatio="none" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="7" stroke-linecap="round"><path d="M-10 70 Q 120 90 240 50 T 360 70"/><path d="M130 -10 L 150 140"/><path d="M250 -10 L 235 140"/></svg>'),
      h('span', { class: 'pin' }, ic('pin', 24)));
    const siteGrad = SITES[ev.location]?.grad ?? ['#55627A', '#8A97AD'];
    mapArt.style.backgroundImage = `linear-gradient(135deg, ${siteGrad[0]}, ${siteGrad[1]})`;

    fill(body,
      h('div', { class: 'loc-top' }, h('a', { class: 'round-btn', href: '#/events', 'aria-label': 'Back to Events' }, ic('back', 20, 2.2)), shareBtn),
      coverEl(ev, { height: 300, radius: 26, fontSize: 40 }),
      h('div', { class: 'ev-info' },
        h('h1', { id: 'page-title', tabindex: '-1' }, ev.title),
        h('div', { class: 'host-line' }, hostDot(ev, 24, 9), h('span', {}, ev.host || CHURCH.name)),
        h('p', { class: 'when-line' }, when),
        h('div', { class: 'pills' }, chips.map((c) => h('span', { class: 'pill-chip' }, c)))),
      h('div', { class: 'acts' },
        regUrl ? h('a', { class: 'act reg', href: regUrl, target: '_blank', rel: 'noopener' }, ic('ticket', 20), h('span', {}, 'Register')) : null,
        h('button', { type: 'button', class: 'act', onclick: () => openSheet('contact') }, ic('mail', 20), h('span', {}, 'Contact')),
        moreBtn, menu),
      h('section', { class: 'blk', 'aria-labelledby': 'loc-h' },
        h('h2', { id: 'loc-h' }, 'Location'),
        h('div', { class: 'card rows loc-card' }, mapArt,
          h('div', { class: 'loc-line' },
            h('span', { class: 'min-text' }, h('b', {}, venue), address ? h('span', { class: 'addr2' }, address) : null),
            address ? h('a', { class: 'dir-dark', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, target: '_blank', rel: 'noopener' }, 'Directions') : null))),
      ev.description ? h('section', { class: 'blk' }, h('h2', {}, 'About'), h('p', { class: 'about' }, ev.description)) : null,
      ev.going > 0 ? h('section', { class: 'blk' }, h('h2', {}, 'Who’s going'),
        h('div', { class: 'going' },
          ev.sample ? h('span', { class: 'faces', 'aria-hidden': 'true' }, FACES.map(([ini, bg], i) => { const f = h('span', { class: 'face' }, ini); f.style.background = bg; if (i) f.style.marginLeft = '-10px'; return f; })) : null,
          h('span', {}, `${ev.going} going`))) : null,
      source !== 'live' ? h('p', { class: 'note', role: 'status' }, source === 'cache' ? "You're offline. Showing what was saved on this phone." : "You're offline. Showing sample content.") : null);
    applyEditor();
  }

  return () => {
    stopSession();
    toast.remove();
    sheetHost.remove();
    app.style.background = '';
  };
}

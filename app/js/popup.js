// The launch pop-up: the one pop-up an admin or approver has made live, shown to everyone once a day, on the first open of
// the day, while the master switch is on and the pop-up is between its start and end. Tapping it opens the linked event.
import { h, dateKey } from './util.js';
import { ic } from './ui.js';
import { load, save, POPUP_SEEN } from './local.js';

// Whether the pop-up in the live slot should show at this moment.
export function popupShowing({ config, popup, now = Date.now() }) {
  return !!(config?.popupsOn && popup && ['approved', 'live'].includes(popup.status) && popup.id === config.livePopupId
    && popup.start <= now && now < popup.end);
}

// Already shown on this phone today (Singapore day)?
export const seenToday = (seen, id, now = Date.now()) => !!seen && seen.id === id && seen.day === dateKey(now);

// A safe link for the banner: only https addresses or the event's own small JPEG ever reach an img.
export const safeImage = (src) => (typeof src === 'string' && (/^https:\/\/\S+$/.test(src) || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src)) ? src : '');

// Draws the pop-up over the app. Returns a function that closes it.
export function openPopup(popup, { host = document.querySelector('.app') ?? document.body, now = Date.now, onClose } = {}) {
  const eventHref = popup.eventId ? `#/events/${encodeURIComponent(popup.eventId)}` : null;
  const image = h('img', { src: safeImage(popup.image), alt: '' });
  const close = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    layer.remove();
    onClose?.();
  };
  const go = () => { close(); if (eventHref) location.hash = eventHref; };
  const x = h('button', { type: 'button', class: 'pu-x', 'aria-label': 'Close', onclick: close }, ic('close', 20, 2.4));
  const banner = eventHref
    ? h('a', { class: 'pu-image', href: eventHref, 'aria-label': `${popup.title}: open the event`, onclick: (e) => { e.preventDefault(); go(); } }, image)
    : h('div', { class: 'pu-image' }, image);
  const card = h('div', { class: 'pu-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pu-title', tabindex: '-1' },
    x, banner,
    h('h2', { id: 'pu-title' }, popup.title),
    eventHref ? h('a', { class: 'pu-go', href: eventHref, onclick: (e) => { e.preventDefault(); go(); } }, 'See the event') : null);
  const layer = h('div', { class: 'pu-layer' }, h('button', { type: 'button', class: 'pu-back', 'aria-label': 'Close', tabindex: '-1', onclick: close }), card);
  // Keep the keyboard inside the pop-up, and close it with Escape.
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const stops = [...card.querySelectorAll('button, a[href]')];
    const i = stops.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); stops.at(-1).focus(); }
    else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
  };
  document.addEventListener('keydown', onKey);
  host.append(layer);
  x.focus();
  // It ends by itself at its end time.
  const timer = setTimeout(close, Math.max(0, Math.min(popup.end - now(), 2147483647)));
  return close;
}

// On app start: show the live pop-up if it is due and has not been shown today. Resolves with the close function, or null.
export async function showLaunchPopup(data, { now = Date.now, host } = {}) {
  let value;
  try { ({ value } = await data.getLivePopup()); } catch { return null; }
  const { config, popup } = value ?? {};
  if (!popupShowing({ config, popup, now: now() }) || seenToday(load(POPUP_SEEN, null), popup.id, now())) return null;
  save(POPUP_SEEN, { id: popup.id, day: dateKey(now()) });
  return openPopup(popup, { host, now });
}

// Things that are private to each phone: who and what you follow, notification settings and what you've read,
// and a saved draft of a new event. Nothing here is sent anywhere.
const PREFIX = 'lc:v1:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage may be full or blocked */ }
}

// A list of ids you can add to and remove from, e.g. the ministries you follow.
export function toggleInList(key, id, fallback = []) {
  const list = load(key, fallback);
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  save(key, next);
  return next;
}

export const FOLLOW_MINISTRIES = 'followMinistries';
export const FOLLOW_SITES = 'followSites';
export const NOTIF_SETTINGS = 'notifSettings';
export const NOTIF_READ = 'notifRead';
export const EVENT_DRAFT = 'eventDraft';
export const EVENTS_VIEW = 'eventsView';

// The design's defaults: everything on except the daily verse.
export const NOTIF_DEFAULTS = { rem: true, chg: true, newev: true, notice: true, verse: false, story: true, book: true };
export const notifSettings = () => ({ ...NOTIF_DEFAULTS, ...load(NOTIF_SETTINGS, {}) });

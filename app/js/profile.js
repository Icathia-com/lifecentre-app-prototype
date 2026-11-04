// The member's own profile: a photo, a banner, a display name, a bio or Bible verse and a birthday (day and month, never the
// year). It is kept on this phone only (lc:v1:profile) and never sent to the server, with one exception made in the edit
// screen: someone with "Can post stories" also saves their display name and photo to their staff entry, so their story circle
// uses them. Plain functions, so tests can run them.
import { firstName } from './greeting.js';

export const PROFILE_KEY = 'profile';
export const LIMITS = { name: 60, bio: 150 };
export const APP_URL = 'https://icathia.com/lifecentre-app-prototype/app/'; // the address an invitation links to
export const PHOTO_SIZE = 320; // the profile photo is saved as a square this many pixels wide, shown in a circle
export const BANNER_SIZE = { width: 1200, height: 400 }; // the banner is saved this wide (3:1)

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 29 February is a real birthday

// A birthday as { day, month } (1-based), or null when it is not a real day of the year.
export function cleanBirthday(b) {
  const day = Number(b?.day);
  const month = Number(b?.month);
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) return null;
  return { day, month };
}
export const daysInMonth = (month) => DAYS_IN[Number(month) - 1] ?? 31;
// "12 Mar"
export const birthdayLabel = (b) => { const c = cleanBirthday(b); return c ? `${c.day} ${MONTHS[c.month - 1].slice(0, 3)}` : ''; };

// Only small JPEG pictures made on this phone are kept.
const picture = (p, max) => (typeof p === 'string' && p.length <= max && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) ? p : '');

export function cleanProfile(raw) {
  return {
    name: String(raw?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name),
    bio: String(raw?.bio ?? '').trim().slice(0, LIMITS.bio),
    birthday: cleanBirthday(raw?.birthday),
    photo: picture(raw?.photo, 200000),
    banner: picture(raw?.banner, 400000),
  };
}

// The invitation shared from the profile. It carries the first name and the app address, and nothing else about the person.
export function shareMessage(profile, url = APP_URL) {
  const first = firstName(cleanProfile(profile).name);
  return first ? `${first} invited you to the Life Centre app. Join us: ${url}` : `You're invited to the Life Centre app. Join us: ${url}`;
}

// The fallback list when the phone has no share sheet: each app's own share address with the same message.
export function shareTargets(message, url = APP_URL) {
  const lead = message.endsWith(url) ? message.slice(0, -url.length).trim() : message;
  const enc = encodeURIComponent;
  return {
    whatsapp: `https://wa.me/?text=${enc(message)}`,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(lead)}`,
    email: `mailto:?subject=${enc('Join me on the Life Centre app')}&body=${enc(message)}`,
  };
}

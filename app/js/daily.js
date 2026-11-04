// The daily verse flow, opened from the verse card on Home: the verse, then today's stories or written devotion, then the streak.
// The counting is kept on the phone (lc:v1:daily) with no sign-in, and nothing about it is sent anywhere. Plain functions, so
// tests can run them. All days are Singapore days ('YYYY-MM-DD').
import { addDays } from './util.js';
import { buildPassage, parsePassageId } from './bible.js';

export const DAILY_KEY = 'daily';
const KEEP = 800; // days remembered: over two years, far more than any streak needs

// { read: [days step 1 was opened], done: [days step 3 was reached] }, each sorted with no repeats.
export function cleanDaily(raw) {
  const days = (list) => [...new Set((Array.isArray(list) ? list : []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-KEEP);
  return { read: days(raw?.read), done: days(raw?.done) };
}
const withDay = (list, day) => (list.includes(day) ? list : [...list, day].sort().slice(-KEEP));
// Step 1 opened: today counts once for "verses read".
export const markRead = (state, day) => { const s = cleanDaily(state); return { ...s, read: withDay(s.read, day) }; };
// Step 3 reached: today counts once for "devotions done" and the streak.
export const markDone = (state, day) => { const s = cleanDaily(state); return { ...s, done: withDay(s.done, day) }; };

// Days in a row with step 3 reached, ending today, or yesterday while today is still to come. A missed day starts it again.
export function streak(done, today) {
  const set = new Set(done);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

// What the streak screen and the profile show.
export function dailyStats(state, today) {
  const s = cleanDaily(state);
  const set = new Set(s.done);
  return {
    versesRead: s.read.length,
    devotionsDone: s.done.length,
    streak: streak(s.done, today),
    week: Array.from({ length: 7 }, (_, k) => { const day = addDays(today, k - 6); return { day, done: set.has(day) }; }),
  };
}

// The steps of today's flow: the verse, then today's stories when someone has one up, else the written devotion when there is
// one, then the streak. With neither, the verse leads straight to the streak.
export function flowSteps({ storyCount = 0, devotion = null } = {}) {
  const middle = storyCount > 0 ? 'stories' : devotion ? 'devotion' : null;
  return ['verse', middle, 'streak'].filter(Boolean);
}

// ---- The full chapter ----

// Shown for a version unless its publisher is Biblica; Biblica versions only once an admin turns their switch on.
export const chapterAllowed = (version, config) => !!version && (version.publisher !== 'biblica' || config?.biblicaChapters === true);
// chapters/{date}_{versionId}: one document per version for the day's chapter, written by the daily job.
export const chapterDocId = (day, versionId) => `${day}_${Number(versionId)}`;

// The day's verses inside the chapter: { from, to } from the passage ('JHN.3.16-17' -> 16..17), or null.
export function dayVerses(passageId) {
  const p = parsePassageId(passageId);
  return p ? { chapter: `${p.code}.${p.chapter}`, from: p.from, to: p.to ?? p.from } : null;
}

// ---- Written devotions (staff schedule one per date) ----

export const DEVOTION_LIMITS = { title: 120, body: 3000, prayer: 1000 };

// The staff form's values -> { values } to save, or { error }.
export function prepareDevotion(v) {
  const title = String(v.title ?? '').trim();
  const body = String(v.body ?? '').trim();
  const prayer = String(v.prayer ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date ?? ''))) return { error: 'Please choose a date.' };
  if (!title) return { error: 'Please give the devotion a title.' };
  if (title.length > DEVOTION_LIMITS.title) return { error: `Keep the title to ${DEVOTION_LIMITS.title} characters.` };
  if (!body) return { error: 'Please write the devotion.' };
  if (body.length > DEVOTION_LIMITS.body) return { error: `Keep the devotion to ${DEVOTION_LIMITS.body} characters.` };
  if (!prayer) return { error: 'Please write the closing prayer.' };
  if (prayer.length > DEVOTION_LIMITS.prayer) return { error: `Keep the prayer to ${DEVOTION_LIMITS.prayer} characters.` };
  const built = buildPassage(v.book, v.chapter, v.verseFrom, v.verseTo);
  if (!built.ok) return { error: built.error };
  return { values: { date: v.date, title, body, prayer, passageId: built.passageId, reference: built.reference } };
}

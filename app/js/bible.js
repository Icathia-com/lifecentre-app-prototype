// Bible versions for the verse of the day: the books, the versions the church may show, the licence rules, and
// how a scheduled passage and the day's text become the card on Home. Plain functions, so tests can run them.
// The daily job (Apps Script) writes votd/{date}; the app only reads it. Keep VERSIONS in step with that job.

export const MAX_VERSES = 25;
export const DEFAULT_VERSION = 111; // NIV
export const FALLBACK_ABBR = 'KJV'; // the built-in verse (public domain) when the day's text or the chosen version is missing, unless an older saved verse names its own translation
export const VERSION_KEY = 'bible-version'; // saved on the phone as lc:v1:bible-version

// [USFM code, name, chapters]. Psalms reads as "Psalm 23:1" in a reference.
const BOOK_ROWS = [
  ['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36], ['DEU', 'Deuteronomy', 34],
  ['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4], ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24],
  ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25], ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10],
  ['NEH', 'Nehemiah', 13], ['EST', 'Esther', 10], ['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31],
  ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Solomon', 8], ['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52], ['LAM', 'Lamentations', 5],
  ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14], ['JOL', 'Joel', 3], ['AMO', 'Amos', 9],
  ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4], ['MIC', 'Micah', 7], ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3],
  ['ZEP', 'Zephaniah', 3], ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4],
  ['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21], ['ACT', 'Acts', 28],
  ['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13], ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6],
  ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4], ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6],
  ['2TI', '2 Timothy', 4], ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5],
  ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5], ['2JN', '2 John', 1], ['3JN', '3 John', 1],
  ['JUD', 'Jude', 1], ['REV', 'Revelation', 22],
];
export const BOOKS = BOOK_ROWS.map(([code, name, chapters]) => ({ code, name, chapters, ref: code === 'PSA' ? 'Psalm' : name }));
const BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export const bookByCode = (code) => BY_CODE.get(code) ?? null;

// ---- Passages ----

const PASSAGE_ID = /^([1-3A-Z][A-Z0-9]{2})\.(\d{1,3})\.(\d{1,3})(?:-(\d{1,3}))?$/;

// Checks the form's choices. Returns { ok: true, passageId, reference } or { ok: false, error }.
export function buildPassage(code, chapter, from, to) {
  const book = bookByCode(code);
  const c = Number(chapter);
  const a = Number(from);
  const b = to === undefined || to === null || to === '' ? null : Number(to);
  if (!book) return { ok: false, error: 'Please choose a book.' };
  if (!Number.isInteger(c) || c < 1 || c > book.chapters) return { ok: false, error: `${book.name} has ${book.chapters} chapter${book.chapters === 1 ? '' : 's'}.` };
  if (!Number.isInteger(a) || a < 1 || a > 176) return { ok: false, error: 'Please enter the first verse.' };
  if (b !== null) {
    if (!Number.isInteger(b) || b < 1 || b > 176) return { ok: false, error: 'Please enter the last verse as a whole number.' };
    if (b <= a) return { ok: false, error: 'The last verse must come after the first verse.' };
    if (b - a + 1 > MAX_VERSES) return { ok: false, error: `Choose ${MAX_VERSES} verses or fewer.` };
  }
  return { ok: true, passageId: `${code}.${c}.${a}${b ? `-${b}` : ''}`, reference: `${book.ref} ${c}:${a}${b ? `-${b}` : ''}` };
}

// 'JHN.3.16-17' -> { code, book, chapter, from, to }, or null when it is not a passage of this shape.
export function parsePassageId(id) {
  const m = PASSAGE_ID.exec(String(id ?? ''));
  if (!m || !bookByCode(m[1])) return null;
  const from = Number(m[3]);
  const to = m[4] ? Number(m[4]) : null;
  if (to !== null && to <= from) return null;
  return { code: m[1], book: bookByCode(m[1]), chapter: Number(m[2]), from, to };
}

export const passageVerseCount = (id) => { const p = parsePassageId(id); return p ? (p.to ?? p.from) - p.from + 1 : 0; };
export const isUsablePassage = (id) => { const p = parsePassageId(id); return !!p && p.chapter >= 1 && p.chapter <= p.book.chapters && passageVerseCount(id) <= MAX_VERSES; };

// Names people type, mapped to a book code.
const ALIASES = (() => {
  const map = new Map();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const b of BOOKS) { map.set(norm(b.name), b.code); map.set(norm(b.ref), b.code); }
  const extra = {
    PSA: ['psalm', 'ps', 'psa'], SNG: ['songofsongs', 'songofsolomon', 'song', 'sos', 'canticles'], REV: ['revelations', 'revelationofjohn', 'rev'],
    GEN: ['gen'], EXO: ['exod', 'ex'], LEV: ['lev'], NUM: ['num'], DEU: ['deut', 'dt'], JOS: ['josh'], JDG: ['judg'], '1SA': ['1sam'], '2SA': ['2sam'],
    '1KI': ['1kgs', '1kin'], '2KI': ['2kgs', '2kin'], '1CH': ['1chron', '1chr'], '2CH': ['2chron', '2chr'], NEH: ['neh'], EST: ['esth'], PRO: ['prov'],
    ECC: ['eccl', 'ecclesiasticus'], ISA: ['isa'], JER: ['jer'], LAM: ['lam'], EZK: ['ezek', 'eze'], DAN: ['dan'], HOS: ['hos'], OBA: ['obad'], JON: ['jonah'],
    MIC: ['mic'], NAM: ['nah'], HAB: ['hab'], ZEP: ['zeph'], HAG: ['hag'], ZEC: ['zech'], MAL: ['mal'], MAT: ['matt', 'mt'], MRK: ['mark', 'mk'],
    LUK: ['lk'], JHN: ['jn'], ACT: ['act'], ROM: ['rom'], '1CO': ['1cor'], '2CO': ['2cor'], GAL: ['gal'], EPH: ['eph'], PHP: ['phil', 'php'],
    COL: ['col'], '1TH': ['1thess', '1thes'], '2TH': ['2thess', '2thes'], '1TI': ['1tim'], '2TI': ['2tim'], TIT: ['tit'], PHM: ['philem', 'phm'],
    HEB: ['heb'], JAS: ['jam', 'jas'], '1PE': ['1pet'], '2PE': ['2pet'], '1JN': ['1jn'], '2JN': ['2jn'], '3JN': ['3jn'], JUD: ['jude'],
  };
  for (const [code, names] of Object.entries(extra)) for (const n of names) map.set(n, code);
  for (const [roman, digit] of [['iii', '3'], ['ii', '2'], ['i', '1'], ['1st', '1'], ['2nd', '2'], ['3rd', '3']]) {
    for (const [key, code] of [...map]) if (key.startsWith(digit)) map.set(roman + key.slice(1), code);
  }
  return { norm, map };
})();

// Takes an old free-text reference such as "John 3:16-17 NKJV" and works out its passage.
// Version letters at the end (NKJV, KJV, NIV, ESV...) are dropped. Returns { passageId, reference } or null when it can't be read
// (for example a whole chapter, a passage across chapters, or more than MAX_VERSES verses).
export function parseReference(text) {
  const cleaned = String(text ?? '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = /^((?:[1-3]|i{1,3}|1st|2nd|3rd)?\s?[A-Za-z][A-Za-z .]*?)\s*(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?(?=$|[\s,;(\[])/i.exec(cleaned);
  if (!m) return null;
  const code = ALIASES.map.get(ALIASES.norm(m[1]));
  if (!code) return null;
  const built = buildPassage(code, m[2], m[3], m[4] && Number(m[4]) > Number(m[3]) ? m[4] : null);
  if (!built.ok) return null;
  // Only a version abbreviation (or nothing) may follow the verses.
  const rest = cleaned.slice(m[0].length).replace(/^[\s,;(\[]+|[\s)\]]+$/g, '');
  if (rest && !/^[A-Za-z]{2,6}\d{0,2}$/.test(rest)) return null;
  return { passageId: built.passageId, reference: built.reference };
}

// ---- Versions and licences ----

// label: shown in English. native: the language in its own script. also: other English names people type.
// wide: its text is set smaller on the Home card, so lines carry several words.
export const LANGUAGES = [
  { id: 'eng', label: 'English', native: 'English', also: [] },
  { id: 'tam', label: 'Tamil', native: 'தமிழ்', also: [], wide: true },
  { id: 'tel', label: 'Telugu', native: 'తెలుగు', also: [], wide: true },
  { id: 'mal', label: 'Malayalam', native: 'മലയാളം', also: [], wide: true },
  { id: 'tha', label: 'Thai', native: 'ไทย', also: [], wide: true },
  { id: 'zho', label: 'Mandarin', native: '中文', also: ['Chinese'] },
];
export const languageById = (id) => LANGUAGES.find((l) => l.id === id) ?? null;

// publisher: 'biblica' and 'lockman' have licence rules below; anything else is public domain or Creative Commons.
// The default of each language comes first.
export const VERSIONS = [
  { id: 111, abbr: 'NIV', name: 'New International Version', language: 'eng', publisher: 'biblica' },
  { id: 2692, abbr: 'NASB 2020', name: 'New American Standard Bible 2020', language: 'eng', publisher: 'lockman' },
  { id: 100, abbr: 'NASB 1995', name: 'New American Standard Bible 1995', language: 'eng', publisher: 'lockman' },
  { id: 1588, abbr: 'AMP', name: 'Amplified Bible', language: 'eng', publisher: 'lockman' },
  { id: 3034, abbr: 'BSB', name: 'Berean Standard Bible', language: 'eng', publisher: 'other' },
  { id: 206, abbr: 'WEB', name: 'World English Bible', language: 'eng', publisher: 'other' },
  { id: 12, abbr: 'ASV', name: 'American Standard Version', language: 'eng', publisher: 'other' },
  { id: 2730, abbr: 'TCV', name: 'Tamil Contemporary Version', language: 'tam', publisher: 'biblica' },
  { id: 1899, abbr: 'IRV', name: 'Tamil Indian Revised Version', language: 'tam', publisher: 'other' },
  { id: 1895, abbr: 'IRV', name: 'Telugu Indian Revised Version', language: 'tel', publisher: 'other' },
  { id: 2431, abbr: 'MCV', name: 'Malayalam Contemporary Version', language: 'mal', publisher: 'biblica' },
  { id: 2333, abbr: 'SVP', name: 'Sathyavedapusthakam 1910', language: 'mal', publisher: 'other' },
  { id: 1912, abbr: 'IRV', name: 'Malayalam Indian Revised Version', language: 'mal', publisher: 'other' },
  { id: 179, abbr: 'TNCV', name: 'Thai New Contemporary Version', language: 'tha', publisher: 'biblica' },
  { id: 175, abbr: 'THAI KJV', name: 'Thai King James Version', language: 'tha', publisher: 'other' },
  { id: 36, abbr: 'CCB', name: 'Chinese Contemporary Bible (Simplified)', language: 'zho', publisher: 'biblica' },
  { id: 1392, abbr: 'CCBT', name: 'Chinese Contemporary Bible (Traditional)', language: 'zho', publisher: 'biblica' },
  { id: 43, abbr: 'CSB', name: 'Chinese Standard Bible', language: 'zho', publisher: 'other' },
];
const VERSION_BY_ID = new Map(VERSIONS.map((v) => [v.id, v]));
export const versionById = (id) => VERSION_BY_ID.get(Number(id)) ?? null;

export const BIBLICA = { href: 'https://www.biblica.com', label: 'Biblica' };
export const LOCKMAN = { href: 'https://www.lockman.org', label: 'The Lockman Foundation' };

// Used for a Lockman version when the API gives no notice of its own.
export const LOCKMAN_NOTICES = {
  2692: 'Scripture quotations from the New American Standard Bible – NASB 2020 Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. All rights reserved. Used by permission.',
  100: 'Scripture quotations from the New American Standard Bible – NASB 1995 Copyright © 1960, 1971, 1977, 1995 by The Lockman Foundation. All rights reserved. Used by permission.',
  1588: 'Scripture quotations from the Amplified® Bible – AMP Copyright © 2015 by The Lockman Foundation. All rights reserved. Used by permission.',
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const httpsUrl = (v) => { const s = text(v); return /^https:\/\/[^\s]+$/.test(s) ? s : ''; };

// The notice to show for a version. entry.notice is what the API supplied (its copyright, with any trademark wording).
export function noticeFor(version, entry) {
  const given = text(entry?.notice);
  if (version?.publisher === 'lockman') return given || LOCKMAN_NOTICES[version.id];
  return given;
}

// The publisher link to show with the notice: { href, label } or null.
export function linkFor(version, entry) {
  if (version?.publisher === 'biblica') return BIBLICA;
  if (version?.publisher === 'lockman') return LOCKMAN;
  const href = httpsUrl(entry?.link);
  return href ? { href, label: text(entry?.publisher) || 'Publisher' } : null;
}

// A day's text for one version may be shown only when it has text and, where a licence needs it, its notice.
export function usableEntry(version, entry) {
  if (!version || !entry || !text(entry.text) || !text(entry.reference)) return false;
  if (version.publisher === 'biblica' || version.publisher === 'lockman') return !!noticeFor(version, entry);
  return true;
}

// ---- The choice saved on this phone ----

export function savedVersion(storage = globalThis.localStorage) {
  try {
    const id = Number(JSON.parse(storage.getItem(`lc:v1:${VERSION_KEY}`)));
    return versionById(id) ? id : DEFAULT_VERSION;
  } catch { return DEFAULT_VERSION; }
}
export function saveVersion(id, storage = globalThis.localStorage) {
  try { storage.setItem(`lc:v1:${VERSION_KEY}`, JSON.stringify(Number(id))); } catch { /* storage may be full or blocked */ }
}

// ---- The card ----

// What Home shows. `votd` is the day's document (or null), `builtIn` the app's own KJV verse { reference, text }, `chosen` a version id.
// Text, reference and footnotes are passed through exactly as supplied.
export function cardFor(votd, builtIn, chosen = DEFAULT_VERSION) {
  const version = versionById(chosen);
  const entry = votd?.versions?.[String(chosen)];
  if (version && usableEntry(version, entry)) {
    const card = {
      fallback: false, id: version.id, abbr: text(entry.abbr) || version.abbr, name: text(entry.name) || version.name,
      reference: entry.reference, text: entry.text, footnotes: Array.isArray(entry.footnotes) ? entry.footnotes.map(String).filter(Boolean) : [],
      notice: noticeFor(version, entry) || '', link: linkFor(version, entry),
      language: version.language,
    };
    // Lockman allows just the version tag as a link when space is tight; the full notice stays on the Contact page.
    if (version.publisher === 'lockman') { card.notice = ''; card.link = { href: LOCKMAN.href, label: card.abbr }; card.tagOnly = true; }
    return card;
  }
  // The built-in verse is KJV; a verse saved before Bible versions carries its own translation, which is shown honestly.
  const own = text(builtIn.translation) || FALLBACK_ABBR;
  return { fallback: true, language: 'eng', id: null, abbr: own, name: own === FALLBACK_ABBR ? 'King James Version' : own, reference: builtIn.reference, text: builtIn.text, footnotes: [], notice: '', link: null };
}

// Versions of the sheet, grouped by language in the order above. `present` marks the ones the day's document has.
export function versionGroups(votd) {
  return LANGUAGES.map((lang) => ({
    ...lang,
    versions: VERSIONS.filter((v) => v.language === lang.id).map((v) => ({ ...v, available: usableEntry(v, votd?.versions?.[String(v.id)]) })),
  })).filter((g) => g.versions.length);
}

// ---- Recent versions, and finding a version by typing ----

export const RECENT_KEY = 'bible-recent'; // saved on the phone as lc:v1:bible-recent: at most three ids, newest first
export const RECENT_MAX = 3;
export const SHORTLIST_DEFAULT = [111, 2730, 36]; // NIV, Tamil Contemporary Version, Chinese Contemporary Bible Simplified
export const RESULT_MAX = 6;

export function savedRecent(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(`lc:v1:${RECENT_KEY}`));
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(Number))].filter((id) => versionById(id)).slice(0, RECENT_MAX);
  } catch { return []; }
}
// Picking a version moves it to the front.
export function saveRecent(id, storage = globalThis.localStorage) {
  const list = [Number(id), ...savedRecent(storage).filter((x) => x !== Number(id))].slice(0, RECENT_MAX);
  try { storage.setItem(`lc:v1:${RECENT_KEY}`, JSON.stringify(list)); } catch { /* storage may be full or blocked */ }
  return list;
}

// The three versions shown before anything is typed: the recent ones, then the usual three to fill, with no repeats.
export function shortlist(recent = []) {
  const ids = [...new Set([...recent.map(Number), ...SHORTLIST_DEFAULT])].filter((id) => versionById(id)).slice(0, RECENT_MAX);
  return ids.map((id) => versionById(id));
}

// Lower case, with spaces and punctuation taken out, so "nasb 2020" and "NASB2020" are the same.
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

// Versions whose abbreviation, full name, language (in English) or language in its own script starts with what was typed.
// Nothing typed gives the shortlist. At most RESULT_MAX results, in the order of the list above.
export function searchVersions(query, recent = []) {
  const q = squash(query);
  if (!q) return shortlist(recent);
  return VERSIONS.filter((v) => {
    const lang = languageById(v.language);
    return [v.abbr, v.name, lang.label, lang.native, ...lang.also].some((t) => squash(t).startsWith(q));
  }).slice(0, RESULT_MAX);
}

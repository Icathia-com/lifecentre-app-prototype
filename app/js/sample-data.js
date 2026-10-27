// Content shown when the database can't be reached and nothing is saved on the phone yet.
// Everything in the sample lists is sample data and is marked `sample: true`.
// Keep ids and titles in step with firebase/seed/seed.json (a test checks this).
import { dateKey, addDays, dayStart } from './util.js';

// Public-domain (KJV) verses, used on days when no verse is scheduled. These are real content, not sample.
export const BACKUP_VERSES = [
  { reference: 'Psalm 46:10', text: 'Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.' },
  { reference: 'Proverbs 3:5', text: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.' },
  { reference: 'Proverbs 3:6', text: 'In all thy ways acknowledge him, and he shall direct thy paths.' },
  { reference: 'Philippians 4:13', text: 'I can do all things through Christ which strengtheneth me.' },
  { reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { reference: 'Psalm 27:1', text: 'The LORD is my light and my salvation; whom shall I fear? the LORD is the strength of my life; of whom shall I be afraid?' },
  { reference: 'Psalm 119:105', text: 'Thy word is a lamp unto my feet, and a light unto my path.' },
  { reference: 'Joshua 1:9', text: 'Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.' },
  { reference: 'Isaiah 41:10', text: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.' },
  { reference: 'Matthew 11:28', text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
  { reference: 'Matthew 6:33', text: 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.' },
  { reference: 'John 3:16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
  { reference: 'Romans 8:28', text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.' },
  { reference: '2 Timothy 1:7', text: 'For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.' },
];

// The same verse for everyone on a given day.
export function backupVerse(key) {
  const day = Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
  return { id: key, translation: 'KJV', ...BACKUP_VERSES[day % BACKUP_VERSES.length] };
}

const HOUR = 3600000;

export function sampleAnnouncements(now = Date.now()) {
  return [
    { id: 'sample-conference', title: 'Empower Conference 2027: registration is open', body: '[A short message from the church team about the conference]', pinned: true, published: true, publishedAt: now - 2 * HOUR, sample: true },
    { id: 'sample-cell-groups', title: 'Cell groups are open for sign-up', body: 'Sample announcement. Find a cell group near you and join this month.', pinned: false, published: true, publishedAt: now - 24 * HOUR, sample: true },
    { id: 'sample-volunteers', title: 'Thank you, volunteers', body: "Sample announcement. Thank you to everyone who served at last weekend's services.", pinned: false, published: true, publishedAt: now - 48 * HOUR, sample: true },
  ];
}

export function sampleEvents(now = Date.now()) {
  const at = (days, hours, minutes = 0) => dayStart(addDays(dateKey(now), days)) + hours * HOUR + minutes * 60000;
  return [
    { id: 'sample-cell-group', title: 'Cell group night', start: at(3, 19, 30), end: at(3, 21), location: '[Venue]', description: 'Sample event.', published: true, sample: true },
    { id: 'sample-prayer', title: 'Prayer and worship evening', start: at(8, 19, 30), end: at(8, 21), location: '[Venue]', description: 'Sample event.', published: true, sample: true },
    { id: 'sample-lunch', title: 'Community lunch', start: at(12, 12, 30), end: at(12, 14), location: '[Venue]', description: 'Sample event.', published: true, sample: true },
  ];
}

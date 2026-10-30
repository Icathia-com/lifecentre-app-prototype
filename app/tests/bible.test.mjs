// Bible versions for the verse of the day: books, passages, the version list, the licence rules and the card.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKS, MAX_VERSES, DEFAULT_VERSION, VERSIONS, LANGUAGES, LOCKMAN_NOTICES, BIBLICA, LOCKMAN,
  buildPassage, parsePassageId, parseReference, passageVerseCount, isUsablePassage,
  versionById, noticeFor, linkFor, usableEntry, cardFor, versionGroups, savedVersion, saveVersion,
} from '../js/bible.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }; };
const BUILT_IN = { reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' };
const NIV_NOTICE = 'Scripture quotations taken from The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide.';
const entry = (extra = {}) => ({ abbr: 'NIV', name: 'New International Version', language: 'eng', reference: 'John 3:16', text: 'For God so loved the world…', footnotes: [], notice: NIV_NOTICE, publisher: 'Biblica', link: 'https://www.biblica.com', ...extra });

describe('the books', () => {
  it('are all 66, in Bible order, with unique USFM codes', () => {
    assert.equal(BOOKS.length, 66);
    assert.deepEqual([BOOKS[0].code, BOOKS[38].code, BOOKS[39].code, BOOKS[65].code], ['GEN', 'MAL', 'MAT', 'REV']);
    assert.equal(new Set(BOOKS.map((b) => b.code)).size, 66);
    assert.deepEqual(BOOKS.slice(0, 5).map((b) => b.name), ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy']);
    assert.equal(BOOKS.find((b) => b.code === 'PSA').chapters, 150);
    assert.equal(BOOKS.reduce((n, b) => n + b.chapters, 0), 1189);
  });
});

describe('building a passage from the staff form', () => {
  it('makes the USFM id and the English reference', () => {
    assert.deepEqual(buildPassage('JHN', 3, 16), { ok: true, passageId: 'JHN.3.16', reference: 'John 3:16' });
    assert.deepEqual(buildPassage('JHN', '3', '16', '17'), { ok: true, passageId: 'JHN.3.16-17', reference: 'John 3:16-17' });
    assert.deepEqual(buildPassage('PSA', 23, 1, 6), { ok: true, passageId: 'PSA.23.1-6', reference: 'Psalm 23:1-6' });
    assert.equal(buildPassage('1JN', 1, 9).reference, '1 John 1:9');
  });
  it('allows 25 verses and refuses 26', () => {
    assert.equal(MAX_VERSES, 25);
    assert.equal(buildPassage('PSA', 119, 1, 25).ok, true);
    const tooLong = buildPassage('PSA', 119, 1, 26);
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.error, /25 verses or fewer/);
    assert.equal(buildPassage('PSA', 119, 1, 176).ok, false);
  });
  it('refuses a missing book, a chapter past the end, and a last verse that does not come after the first', () => {
    assert.equal(buildPassage('XXX', 1, 1).ok, false);
    assert.match(buildPassage('JHN', 22, 1).error, /John has 21 chapters/);
    assert.match(buildPassage('OBA', 2, 1).error, /Obadiah has 1 chapter\./);
    assert.equal(buildPassage('JHN', 3, 16, 16).ok, false);
    assert.equal(buildPassage('JHN', 3, 16, 10).ok, false);
    assert.equal(buildPassage('JHN', 3, '', undefined).ok, false);
  });
  it('reads a passage id back, and counts its verses', () => {
    assert.deepEqual(parsePassageId('JHN.3.16-17'), { code: 'JHN', book: BOOKS.find((b) => b.code === 'JHN'), chapter: 3, from: 16, to: 17 });
    assert.equal(passageVerseCount('JHN.3.16'), 1);
    assert.equal(passageVerseCount('PSA.119.1-25'), 25);
    assert.equal(isUsablePassage('PSA.119.1-26'), false);
    assert.equal(isUsablePassage('JHN.22.1'), false);
    for (const bad of ['', 'John 3:16', 'JHN.3', 'JHN.3.16-10', 'ZZZ.1.1', null, undefined]) assert.equal(parsePassageId(bad), null, String(bad));
  });
});

describe('converting an old typed reference', () => {
  it('works out the passage and drops version letters at the end', () => {
    const cases = [
      ['John 3:16', 'JHN.3.16', 'John 3:16'],
      ['John 3:16 NKJV', 'JHN.3.16', 'John 3:16'],
      ['John 3:16-17 KJV', 'JHN.3.16-17', 'John 3:16-17'],
      ['Psalm 23:1–3 NIV', 'PSA.23.1-3', 'Psalm 23:1-3'],
      ['Psalms 46:10', 'PSA.46.10', 'Psalm 46:10'],
      ['1 John 1:9 ESV', '1JN.1.9', '1 John 1:9'],
      ['2 Timothy 1:7', '2TI.1.7', '2 Timothy 1:7'],
      ['I Corinthians 13:4', '1CO.13.4', '1 Corinthians 13:4'],
      ['Song of Songs 2:4', 'SNG.2.4', 'Song of Solomon 2:4'],
      ['Philippians 4:13 (NKJV)', 'PHP.4.13', 'Philippians 4:13'],
      ['  matthew 6:33  ', 'MAT.6.33', 'Matthew 6:33'],
      ['Rev 21:4', 'REV.21.4', 'Revelation 21:4'],
    ];
    for (const [from, passageId, reference] of cases) assert.deepEqual(parseReference(from), { passageId, reference }, from);
  });
  it('gives up on what it cannot read, so it can be fixed by hand', () => {
    for (const bad of ['Psalm 23', 'John', 'Hezekiah 3:1', 'John 3:16 is good', 'Psalm 119:1-30', 'John 22:1', '', null]) assert.equal(parseReference(bad), null, String(bad));
  });
});

describe('the versions', () => {
  it('are the agreed list, grouped by language, the default first in each group', () => {
    assert.deepEqual(VERSIONS.map((v) => v.id), [111, 2692, 100, 1588, 3034, 206, 12, 2730, 1899, 1895, 2431, 2333, 1912, 179, 175, 36, 1392, 43]);
    assert.equal(DEFAULT_VERSION, 111);
    assert.equal(VERSIONS[0].id, DEFAULT_VERSION);
    const groups = versionGroups(null);
    assert.deepEqual(groups.map((g) => g.label), ['English', 'Tamil', 'Telugu', 'Malayalam', 'Thai', 'Mandarin']);
    assert.deepEqual(groups.map((g) => g.versions[0].id), [111, 2730, 1895, 2431, 179, 36]);
    assert.deepEqual(groups.map((g) => g.versions.length), [7, 2, 1, 3, 2, 3]);
    assert.equal(LANGUAGES.length, 6);
  });
  it('mark the Biblica and Lockman versions', () => {
    const by = (p) => VERSIONS.filter((v) => v.publisher === p).map((v) => v.id);
    assert.deepEqual(by('biblica'), [111, 2730, 2431, 179, 36, 1392]);
    assert.deepEqual(by('lockman'), [2692, 100, 1588]);
  });
});

describe('licence rules', () => {
  it('Biblica versions always show their notice from the API and a link to Biblica', () => {
    for (const id of [111, 2730, 2431, 179, 36, 1392]) {
      const v = versionById(id);
      assert.equal(noticeFor(v, entry()), NIV_NOTICE);
      assert.deepEqual(linkFor(v, entry({ link: 'https://elsewhere.example' })), BIBLICA);
      assert.equal(linkFor(v, entry()).href, 'https://www.biblica.com');
      assert.match(linkFor(v, entry()).label, /Biblica/);
      assert.equal(usableEntry(v, entry({ notice: '' })), false, `${id} is not shown without its notice`);
      assert.equal(usableEntry(v, entry({ notice: '   ' })), false);
      assert.equal(usableEntry(v, entry()), true);
    }
  });
  it('Lockman versions show the API notice, or their own short notice, and a link to Lockman', () => {
    const exact = {
      2692: 'Scripture quotations from the New American Standard Bible – NASB 2020 Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. All rights reserved. Used by permission.',
      100: 'Scripture quotations from the New American Standard Bible – NASB 1995 Copyright © 1960, 1971, 1977, 1995 by The Lockman Foundation. All rights reserved. Used by permission.',
      1588: 'Scripture quotations from the Amplified® Bible – AMP Copyright © 2015 by The Lockman Foundation. All rights reserved. Used by permission.',
    };
    assert.deepEqual(LOCKMAN_NOTICES, exact);
    for (const [id, notice] of Object.entries(exact)) {
      const v = versionById(id);
      assert.equal(noticeFor(v, entry({ notice: '' })), notice);
      assert.equal(noticeFor(v, entry({ notice: 'The API’s own notice' })), 'The API’s own notice');
      assert.deepEqual(linkFor(v, entry({ link: '' })), LOCKMAN);
      assert.equal(LOCKMAN.href, 'https://www.lockman.org');
      assert.equal(usableEntry(v, entry({ notice: '' })), true);
    }
  });
  it('other versions need only text, and link to their publisher only over https', () => {
    const web = versionById(206);
    assert.equal(usableEntry(web, entry({ notice: '', link: '' })), true);
    assert.deepEqual(linkFor(web, entry({ link: 'https://worldenglishbible.org', publisher: 'worldenglishbible.org' })), { href: 'https://worldenglishbible.org', label: 'worldenglishbible.org' });
    assert.equal(linkFor(web, entry({ link: 'http://insecure.example' })), null);
    assert.equal(linkFor(web, entry({ link: 'javascript:alert(1)' })), null);
    assert.equal(linkFor(web, entry({ link: '' })), null);
    assert.equal(usableEntry(web, entry({ text: '' })), false);
    assert.equal(usableEntry(web, entry({ reference: '' })), false);
  });
});

describe('the card', () => {
  const votd = { versions: { 111: entry({ footnotes: ['Or *Messiah*'] }), 206: entry({ abbr: 'WEB', name: 'World English Bible', text: 'For God so loved the world, that he gave…', notice: '', publisher: '', link: '' }) } };
  it('shows the text exactly as supplied, with the reference, notice, link and footnotes', () => {
    const card = cardFor({ versions: { 111: entry({ text: '  “For God so loved\nthe world…”  ', footnotes: ['Or *Messiah*', 'Some manuscripts add…'] }) } }, BUILT_IN, 111);
    assert.equal(card.fallback, false);
    assert.equal(card.text, '  “For God so loved\nthe world…”  ');
    assert.deepEqual([card.abbr, card.reference, card.notice, card.link], ['NIV', 'John 3:16', NIV_NOTICE, BIBLICA]);
    assert.deepEqual(card.footnotes, ['Or *Messiah*', 'Some manuscripts add…']);
  });
  it('shows the chosen version, and NIV when nothing has been chosen', () => {
    assert.equal(cardFor(votd, BUILT_IN).abbr, 'NIV');
    const web = cardFor(votd, BUILT_IN, 206);
    assert.deepEqual([web.abbr, web.fallback, web.link, web.notice], ['WEB', false, null, '']);
  });
  it('falls back to the built-in KJV verse when the day has no text, or lacks the chosen version', () => {
    for (const day of [null, undefined, {}, { versions: {} }, votd]) {
      const card = cardFor(day, BUILT_IN, day === votd ? 2730 : 111);
      assert.deepEqual([card.fallback, card.abbr, card.reference, card.text, card.notice, card.link, card.footnotes], [true, 'KJV', BUILT_IN.reference, BUILT_IN.text, '', null, []]);
    }
  });
  it('labels a verse saved before Bible versions with its own translation', () => {
    const card = cardFor(null, { ...BUILT_IN, translation: 'NKJV' }, 111);
    assert.deepEqual([card.fallback, card.abbr, card.text], [true, 'NKJV', BUILT_IN.text]);
    assert.equal(cardFor(null, { ...BUILT_IN, translation: 'KJV' }, 111).abbr, 'KJV');
  });
  it('falls back when a Biblica text arrives without its notice, rather than showing it bare', () => {
    const card = cardFor({ versions: { 111: entry({ notice: '' }) } }, BUILT_IN, 111);
    assert.deepEqual([card.fallback, card.abbr], [true, 'KJV']);
  });
  it('marks which versions the day has', () => {
    const flat = versionGroups(votd).flatMap((g) => g.versions);
    assert.deepEqual(flat.filter((v) => v.available).map((v) => v.id), [111, 206]);
  });
});

describe('the choice saved on the phone', () => {
  it('is kept under lc:v1:bible-version, and NIV is used when nothing, or something unknown, is saved', () => {
    const s = memory();
    assert.equal(savedVersion(s), 111);
    saveVersion(2730, s);
    assert.equal(s.map.get('lc:v1:bible-version'), '2730');
    assert.equal(savedVersion(s), 2730);
    s.map.set('lc:v1:bible-version', '999999');
    assert.equal(savedVersion(s), 111);
    s.map.set('lc:v1:bible-version', 'not json');
    assert.equal(savedVersion(s), 111);
  });
  it('survives storage that is blocked', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(savedVersion(blocked), 111);
    assert.doesNotThrow(() => saveVersion(206, blocked));
  });
});

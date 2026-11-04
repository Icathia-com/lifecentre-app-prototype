// The daily verse flow and the profile: steps, counting, the streak, the chapter rule, devotions and the share message.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDaily, markRead, markDone, streak, dailyStats, flowSteps, chapterAllowed, chapterDocId, dayVerses, prepareDevotion, DEVOTION_LIMITS } from '../js/daily.js';
import { cleanProfile, cleanBirthday, birthdayLabel, shareMessage, shareTargets, APP_URL, LIMITS } from '../js/profile.js';
import { versionById, VERSIONS } from '../js/bible.js';

describe('the flow steps', () => {
  it('verse, then stories when someone has one up, then the streak', () => {
    assert.deepEqual(flowSteps({ storyCount: 2, devotion: { title: 'x' } }), ['verse', 'stories', 'streak']);
  });
  it('the written devotion when no story is up', () => {
    assert.deepEqual(flowSteps({ storyCount: 0, devotion: { title: 'x' } }), ['verse', 'devotion', 'streak']);
  });
  it('straight from the verse to the streak when there is neither', () => {
    assert.deepEqual(flowSteps({ storyCount: 0, devotion: null }), ['verse', 'streak']);
    assert.deepEqual(flowSteps(), ['verse', 'streak']);
  });
});

describe('counting on the phone', () => {
  it('counts a verse read once a day, and a devotion done once a day', () => {
    let s = markRead({}, '2026-11-04');
    s = markRead(s, '2026-11-04');
    s = markRead(s, '2026-11-05');
    s = markDone(s, '2026-11-05');
    s = markDone(s, '2026-11-05');
    assert.deepEqual(s, { read: ['2026-11-04', '2026-11-05'], done: ['2026-11-05'] });
    assert.deepEqual([dailyStats(s, '2026-11-05').versesRead, dailyStats(s, '2026-11-05').devotionsDone], [2, 1]);
  });
  it('ignores anything that is not a list of days', () => {
    assert.deepEqual(cleanDaily(null), { read: [], done: [] });
    assert.deepEqual(cleanDaily({ read: 'x', done: ['2026-11-01', 'nope', 5, '2026-11-01'] }), { read: [], done: ['2026-11-01'] });
  });
});

describe('the streak', () => {
  const days = (...list) => list;
  it('counts days in a row ending today', () => {
    assert.equal(streak(days('2026-11-02', '2026-11-03', '2026-11-04'), '2026-11-04'), 3);
  });
  it('keeps yesterday\'s streak while today is still to come', () => {
    assert.equal(streak(days('2026-11-02', '2026-11-03'), '2026-11-04'), 2);
  });
  it('starts again after a missed day', () => {
    assert.equal(streak(days('2026-11-01', '2026-11-02'), '2026-11-04'), 0, 'yesterday missed: back to 0');
    assert.equal(streak(days('2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04'), '2026-11-04'), 3, 'the gap on 1 November ends the older run');
  });
  it('runs across a month and a year end', () => {
    assert.equal(streak(days('2026-12-30', '2026-12-31', '2027-01-01'), '2027-01-01'), 3);
    assert.equal(streak(days('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-01'), 3);
  });
  it('shows the last 7 days, oldest first, marked done or not', () => {
    const week = dailyStats({ done: ['2026-10-29', '2026-11-03', '2026-11-04'] }, '2026-11-04').week;
    assert.deepEqual(week.map((d) => d.day), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    assert.deepEqual(week.map((d) => d.done), [true, false, false, false, false, true, true]);
  });
});

describe('the full chapter', () => {
  it('is offered for every version whose publisher is not Biblica', () => {
    for (const v of VERSIONS.filter((x) => x.publisher !== 'biblica')) assert.equal(chapterAllowed(v, { biblicaChapters: false }), true, v.abbr);
  });
  it('is offered for Biblica versions only once the admin switch is on', () => {
    for (const v of VERSIONS.filter((x) => x.publisher === 'biblica')) {
      assert.equal(chapterAllowed(v, { biblicaChapters: false }), false, v.abbr);
      assert.equal(chapterAllowed(v, {}), false, v.abbr);
      assert.equal(chapterAllowed(v, null), false, v.abbr);
      assert.equal(chapterAllowed(v, { biblicaChapters: 'yes' }), false, 'only a real true turns it on');
      assert.equal(chapterAllowed(v, { biblicaChapters: true }), true, v.abbr);
    }
    assert.equal(chapterAllowed(null, { biblicaChapters: true }), false);
  });
  it('is one document per version and day, and knows the day\'s verses inside it', () => {
    assert.equal(chapterDocId('2026-11-04', versionById(206).id), '2026-11-04_206');
    assert.deepEqual(dayVerses('JHN.3.16-17'), { chapter: 'JHN.3', from: 16, to: 17 });
    assert.deepEqual(dayVerses('PSA.23.1'), { chapter: 'PSA.23', from: 1, to: 1 });
    assert.equal(dayVerses('nope'), null);
  });
});

describe('written devotions (the staff form)', () => {
  const ok = { date: '2026-11-05', title: ' Rest ', body: 'Come to me.\n\nAll who are weary.', book: 'MAT', chapter: '11', verseFrom: '28', verseTo: '30', prayer: 'Lord, give us rest.' };
  it('becomes a passage, a title, the devotion and a prayer', () => {
    assert.deepEqual(prepareDevotion(ok), { values: { date: '2026-11-05', title: 'Rest', body: 'Come to me.\n\nAll who are weary.', prayer: 'Lord, give us rest.', passageId: 'MAT.11.28-30', reference: 'Matthew 11:28-30' } });
  });
  it('allows a devotion of exactly 3000 characters and refuses more', () => {
    assert.ok(prepareDevotion({ ...ok, body: 'a'.repeat(DEVOTION_LIMITS.body) }).values);
    assert.match(prepareDevotion({ ...ok, body: 'a'.repeat(DEVOTION_LIMITS.body + 1) }).error, /3000/);
  });
  it('asks for every part, and a passage of at most 25 verses', () => {
    assert.match(prepareDevotion({ ...ok, title: '' }).error, /title/);
    assert.match(prepareDevotion({ ...ok, body: ' ' }).error, /write the devotion/);
    assert.match(prepareDevotion({ ...ok, prayer: '' }).error, /prayer/);
    assert.match(prepareDevotion({ ...ok, date: '' }).error, /date/);
    assert.match(prepareDevotion({ ...ok, verseFrom: '1', verseTo: '30' }).error, /25 verses/);
  });
});

describe('the profile (kept on the phone)', () => {
  it('keeps the name and the bio or verse to their lengths', () => {
    const p = cleanProfile({ name: `  ${'N'.repeat(80)} `, bio: 'b'.repeat(200) });
    assert.equal(p.name.length, LIMITS.name);
    assert.equal(p.bio.length, 150);
  });
  it('keeps a birthday as day and month only, never a year, and only a real day', () => {
    assert.deepEqual(cleanBirthday({ day: 29, month: 2, year: 1990 }), { day: 29, month: 2 });
    assert.equal(cleanBirthday({ day: 31, month: 4 }), null);
    assert.equal(cleanBirthday({ day: 0, month: 1 }), null);
    assert.equal(cleanBirthday({ day: 5 }), null);
    assert.deepEqual(cleanProfile({ birthday: { day: '12', month: '3', year: 2000 } }).birthday, { day: 12, month: 3 });
    assert.equal(birthdayLabel({ day: 12, month: 3 }), '12 Mar');
    assert.equal(birthdayLabel(null), '');
  });
  it('keeps only small JPEG pictures made on the phone', () => {
    assert.equal(cleanProfile({ photo: 'data:image/jpeg;base64,AAAA' }).photo, 'data:image/jpeg;base64,AAAA');
    assert.equal(cleanProfile({ photo: 'https://example.org/me.jpg' }).photo, '');
    assert.equal(cleanProfile({ photo: 'data:image/svg+xml;base64,AAAA' }).photo, '');
    assert.equal(cleanProfile({ banner: `data:image/jpeg;base64,${'A'.repeat(500000)}` }).banner, '');
  });
});

describe('the invitation', () => {
  it('names the person by first name, then the app address', () => {
    assert.equal(shareMessage({ name: 'Grace Lim' }), `Grace invited you to the Life Centre app. Join us: ${APP_URL}`);
  });
  it('has its own wording when no name is set', () => {
    assert.equal(shareMessage({}), `You're invited to the Life Centre app. Join us: ${APP_URL}`);
    assert.equal(shareMessage({ name: '   ' }), `You're invited to the Life Centre app. Join us: ${APP_URL}`);
  });
  it('carries nothing else about the person: no bio, birthday or picture', () => {
    const msg = shareMessage({ name: 'Grace Lim', bio: 'Psalm 23', birthday: { day: 1, month: 2 }, photo: 'data:image/jpeg;base64,AAAA' });
    assert.doesNotMatch(msg, /Lim|Psalm|base64|Feb/);
  });
  it('opens WhatsApp, Telegram and email with the same message', () => {
    const msg = shareMessage({ name: 'Grace' });
    const t = shareTargets(msg);
    assert.equal(t.whatsapp, `https://wa.me/?text=${encodeURIComponent(msg)}`);
    assert.equal(t.telegram, `https://t.me/share/url?url=${encodeURIComponent(APP_URL)}&text=${encodeURIComponent('Grace invited you to the Life Centre app. Join us:')}`);
    assert.match(t.email, /^mailto:\?subject=Join%20me%20on%20the%20Life%20Centre%20app&body=/);
    assert.ok(decodeURIComponent(t.email.split('body=')[1]) === msg);
  });
  it('is the live app address', () => assert.equal(APP_URL, 'https://icathia.com/lifecentre-app-prototype/app/'));
});

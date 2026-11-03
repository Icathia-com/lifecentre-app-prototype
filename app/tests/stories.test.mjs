// Stories: the 30-second parts, the limits, who has a live story, and what is remembered on the phone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitParts, partsFor, shownSeconds, maxSeconds, groupByAuthor, seenAll, markSeen, flatten, circleLabel, timeAgo, clock, safeMedia, PART_LIMITS } from '../js/stories.js';

const NOW = Date.parse('2026-11-03T06:00:00Z');
const HOUR = 3600000;
const story = (extra) => ({ id: 'x', author: 'sam@lifecentre.sg', authorName: 'Samuel Tan', type: 'video', parts: [{ start: 0, end: 30 }], duration: 30, createdAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR, ...extra });

describe('30-second parts', () => {
  it('splits a recording into consecutive parts, the last one shorter', () => {
    assert.deepEqual(splitParts(75), [{ start: 0, end: 30 }, { start: 30, end: 60 }, { start: 60, end: 75 }]);
    assert.deepEqual(splitParts(30), [{ start: 0, end: 30 }]);
    assert.deepEqual(splitParts(30.5), [{ start: 0, end: 30 }, { start: 30, end: 30.5 }]);
    assert.deepEqual(splitParts(0), [{ start: 0, end: 0 }]);
    assert.deepEqual(splitParts(5, { partSeconds: 2 }), [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 5 }]);
  });
  it('stops at the limit: 6 parts of video (3 minutes), 10 of voice (5 minutes)', () => {
    assert.deepEqual([PART_LIMITS.video, PART_LIMITS.audio, maxSeconds('video'), maxSeconds('audio')], [6, 10, 180, 300]);
    assert.equal(partsFor('video', 600).length, 6);
    assert.deepEqual(partsFor('video', 600).at(-1), { start: 150, end: 180 });
    assert.equal(partsFor('audio', 600).length, 10);
    assert.deepEqual(partsFor('audio', 600).at(-1), { start: 270, end: 300 });
    assert.deepEqual(partsFor('video', 45), [{ start: 0, end: 30 }, { start: 30, end: 45 }]);
    assert.deepEqual([shownSeconds('video', 600), shownSeconds('audio', 42), shownSeconds('photo', 0), shownSeconds('text', 0)], [180, 42, 5, 6]);
  });
  it('gives a photo or a text story one short part', () => {
    assert.deepEqual(partsFor('photo', 0), [{ start: 0, end: 5 }]);
    assert.deepEqual(partsFor('text', 99), [{ start: 0, end: 6 }]);
  });
});

describe('who has a live story', () => {
  it('groups by person, newest first, with their stories oldest first, leaving out expired ones', () => {
    const groups = groupByAuthor([
      story({ id: 'a', createdAt: NOW - 3 * HOUR }),
      story({ id: 'b', author: 'grace@lifecentre.sg', authorName: 'Grace Lim', createdAt: NOW - HOUR }),
      story({ id: 'c', createdAt: NOW - 2 * HOUR, authorName: 'Pastor Sam', authorPhoto: 'https://pub.r2.dev/avatars/sam.jpg' }),
      story({ id: 'gone', author: 'eve@lifecentre.sg', createdAt: NOW - 30 * HOUR, expiresAt: NOW - 6 * HOUR }),
      story({ id: 'broken', author: 'eve@lifecentre.sg', parts: [] }),
    ], NOW);
    assert.deepEqual(groups.map((g) => [g.author, g.name, g.photo, g.stories.map((s) => s.id), g.newest]), [
      ['grace@lifecentre.sg', 'Grace Lim', '', ['b'], NOW - HOUR],
      ['sam@lifecentre.sg', 'Pastor Sam', 'https://pub.r2.dev/avatars/sam.jpg', ['a', 'c'], NOW - 2 * HOUR],
    ]);
    assert.deepEqual(flatten(groups[1]).map((p) => [p.story.id, p.pi]), [['a', 0], ['c', 0]]);
    assert.equal(circleLabel(groups[0]), 'Grace');
  });
  it('remembers on the phone which person has been watched up to their newest story', () => {
    const g = { author: 'sam@lifecentre.sg', newest: NOW - HOUR };
    assert.equal(seenAll(g, {}), false);
    assert.equal(seenAll(g, { 'sam@lifecentre.sg': NOW - 2 * HOUR }), false, 'a newer story since');
    const seen = markSeen({}, g);
    assert.deepEqual(seen, { 'sam@lifecentre.sg': NOW - HOUR });
    assert.equal(seenAll(g, seen), true);
    assert.deepEqual(markSeen(seen, { author: 'sam@lifecentre.sg', newest: NOW - 5 * HOUR }), seen, 'never goes backwards');
  });
  it('writes times and keeps media to https', () => {
    assert.deepEqual([timeAgo(NOW - 5 * 60000, NOW), timeAgo(NOW - 3 * HOUR, NOW), clock(75), clock(0), clock(600)], ['5m', '3h', '1:15', '0:00', '10:00']);
    assert.deepEqual([safeMedia('https://pub.r2.dev/s.webm'), safeMedia('http://x/s.webm'), safeMedia('javascript:x'), safeMedia(undefined)], ['https://pub.r2.dev/s.webm', '', '', '']);
  });
});

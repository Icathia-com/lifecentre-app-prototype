// Stories: the 30-second parts, the limits, who has a live story, and what is remembered on the phone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitParts, partsFor, shownSeconds, maxSeconds, groupByAuthor, seenAll, markSeen, flatten, circleLabel, timeAgo, clock, safeMedia, PART_LIMITS, PALETTE, tapAction, releaseAction, lockReached, ringFraction, ringMarks, nextColours, layerWords, wrapLines, ZOOM_RANGE, clampZoom, zoomFromSlide, formatZoom, cropRect, cameraConstraints, pickCamera, ultraWideOf } from '../js/stories.js';
import { hitLayer, fitBox, emptyOverlay, isEmpty, clampSize, MIN_SIZE, MAX_SIZE } from '../js/story-canvas.js';

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
      story({ id: 'broken2', author: 'eve@lifecentre.sg', parts: ['x'] }),
      story({ id: 'broken3', author: 'eve@lifecentre.sg', parts: [{ start: 'a', end: 30 }] }),
      story({ id: 'broken4', author: 'eve@lifecentre.sg', parts: [{ start: 30, end: 10 }] }),
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

describe('the camera (posting like Instagram)', () => {
  it('knows what a tap on the shutter does: a photo, a hands-free recording, a stop, or on to the preview', () => {
    assert.equal(tapAction({ mode: 'story', recording: false, handsFree: false }), 'photo');
    assert.equal(tapAction({ mode: 'story', recording: false, handsFree: true }), 'start');
    assert.equal(tapAction({ mode: 'voice', recording: false, handsFree: false }), 'start');
    assert.equal(tapAction({ mode: 'story', recording: true, handsFree: false }), 'stop');
    assert.equal(tapAction({ mode: 'voice', recording: true, handsFree: true }), 'stop');
    assert.equal(tapAction({ mode: 'text', recording: false, handsFree: false }), 'next');
    assert.deepEqual([releaseAction({ locked: true }), releaseAction({ locked: false })], ['keep', 'stop'], 'letting go after a hold');
    assert.deepEqual([lockReached(200, 131), lockReached(200, 130), lockReached(200, 260)], [false, true, false], 'sliding 70 pixels to the left, onto the lock, locks');
  });
  it('fills the ring round the shutter and marks every part', () => {
    assert.deepEqual([ringFraction(0, 180), ringFraction(90, 180), ringFraction(200, 180), ringFraction(5, 0)], [0, 0.5, 1, 0]);
    assert.deepEqual(ringMarks(6), [60, 120, 180, 240, 300]);
    assert.equal(ringMarks(10).length, 9);
    assert.deepEqual(ringMarks(1), []);
  });
  it('cycles the background colours and gathers the words for screen readers', () => {
    assert.deepEqual(nextColours(PALETTE[0]), PALETTE[1]);
    assert.deepEqual(nextColours(PALETTE.at(-1)), PALETTE[0]);
    assert.deepEqual(nextColours(['#000000', '#111111']), PALETTE[0], 'an unknown pair starts the palette again');
    assert.equal(layerWords([{ text: ' Hello ' }, { text: '' }, { text: 'church' }]), 'Hello\nchurch');
    assert.equal(layerWords([{ text: 'x'.repeat(400) }]).length, 300);
    assert.equal(layerWords([]), '');
  });
  it('wraps words into lines no wider than the space, breaking a word only when it must', () => {
    const measure = (t) => t.length * 10;
    assert.deepEqual(wrapLines('Service at ten thirty', 100, measure), ['Service at', 'ten thirty']);
    assert.deepEqual(wrapLines('one\ntwo three', 100, measure), ['one', 'two three']);
    assert.deepEqual(wrapLines('extraordinarily long', 50, measure), ['extra', 'ordin', 'arily', 'long']);
    assert.deepEqual(wrapLines('', 100, measure), ['']);
    assert.deepEqual(wrapLines('a  b', 100, measure), ['a b']);
  });
  it('finds the piece of text under a tap (the top one first), keeps sizes within reach, and fits a picture in the stage', () => {
    const boxes = [{ id: 'a', left: 0, top: 0, width: 100, height: 50 }, { id: 'b', left: 50, top: 25, width: 100, height: 50 }];
    assert.deepEqual([hitLayer(boxes, 10, 10), hitLayer(boxes, 75, 40), hitLayer(boxes, 140, 70), hitLayer(boxes, 300, 300), hitLayer([], 1, 1)], ['a', 'b', 'b', null, null]);
    assert.deepEqual([clampSize(0.001), clampSize(5), clampSize(0.1), clampSize('x')], [MIN_SIZE, MAX_SIZE, 0.1, 0.085]);
    assert.deepEqual([isEmpty(emptyOverlay()), isEmpty({ strokes: [], layers: [{ id: 't1', text: 'x' }] }), isEmpty(null)], [true, false, true]);
    const contain = fitBox(1600, 900, 1080, 1920, 'contain');
    assert.deepEqual([contain.x, Math.round(contain.y), contain.width, Math.round(contain.height)], [0, 656, 1080, 608], 'a landscape clip sits in the middle with bars above and below');
    const cover = fitBox(1600, 900, 1080, 1920, 'cover');
    assert.deepEqual([Math.round(cover.x), cover.y, Math.round(cover.width), cover.height], [-1167, 0, 3413, 1920], 'cover fills the stage and crops the sides');
    assert.deepEqual(fitBox(1080, 1920, 1080, 1920), { x: 0, y: 0, width: 1080, height: 1920 });
  });
  it('zooms: clamped to the camera or to 1x-4x, a slide up from the shutter zooms in, and the level reads 1x, 0.5x, 2.3x', () => {
    assert.deepEqual([clampZoom(0.2), clampZoom(9), clampZoom(2.5), clampZoom(NaN), clampZoom(0.5, { min: 0.5, max: 8 })], [1, 4, 2.5, 1, 0.5]);
    assert.deepEqual(ZOOM_RANGE, { min: 1, max: 4 });
    assert.equal(zoomFromSlide(1, 0), 1);
    assert.ok(zoomFromSlide(1, -150) > 2.6 && zoomFromSlide(1, -150) < 2.8, 'about 2.7 times after 150 pixels up');
    assert.equal(zoomFromSlide(2, 150), clampZoom(2 / Math.E), 'down zooms out');
    assert.equal(zoomFromSlide(1, 100), 1, 'never below 1x');
    assert.equal(zoomFromSlide(3, -500), 4, 'never above the top');
    assert.deepEqual([formatZoom(1), formatZoom(0.5), formatZoom(2.26), formatZoom(1.96), formatZoom(4)], ['1x', '0.5x', '2.3x', '2x', '4x']);
  });
  it('crops the camera picture to the story shape, then by the zoom, from the middle', () => {
    assert.deepEqual(cropRect(1080, 1920), { x: 0, y: 0, width: 1080, height: 1920 }, 'a portrait picture is used whole');
    const landscape = cropRect(1920, 1080);
    assert.deepEqual([Math.round(landscape.x), landscape.y, Math.round(landscape.width), landscape.height], [656, 0, 608, 1080], 'a landscape picture: the middle 9:16 slice');
    const zoomed = cropRect(1080, 1920, 2);
    assert.deepEqual(zoomed, { x: 270, y: 480, width: 540, height: 960 }, 'twice the zoom shows the middle half');
    assert.deepEqual(cropRect(1080, 1920, 0.3), cropRect(1080, 1920, 1), 'zoom never goes below 1x in the crop');
  });
  it('asks the camera for a 9:16 picture at about 1080 by 1920 with no microphone, and picks the main lens on a side', () => {
    const want = cameraConstraints('environment');
    assert.deepEqual(want, { video: { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, frameRate: { ideal: 30 }, resizeMode: { exact: 'none' }, zoom: true, facingMode: 'environment' }, audio: false }, 'never a cropped (zoomed) picture, never the microphone');
    assert.deepEqual(cameraConstraints('user', 'cam-7').video.deviceId, { exact: 'cam-7' });
    assert.equal(cameraConstraints('user', 'cam-7').video.facingMode, undefined);
    const iphone = [
      { kind: 'videoinput', deviceId: 'f', label: 'Front Camera' }, { kind: 'videoinput', deviceId: 'b', label: 'Back Camera' },
      { kind: 'videoinput', deviceId: 't', label: 'Back Telephoto Camera' }, { kind: 'videoinput', deviceId: 'u', label: 'Back Ultra Wide Camera' },
      { kind: 'videoinput', deviceId: 'd', label: 'Back Dual Wide Camera' }, { kind: 'audioinput', deviceId: 'm', label: 'Back Microphone' },
    ];
    assert.deepEqual([pickCamera(iphone, 'environment'), pickCamera(iphone, 'user'), ultraWideOf(iphone, 'environment'), ultraWideOf(iphone, 'user')], ['b', 'f', 'u', null]);
    const android = [
      { kind: 'videoinput', deviceId: 'a2', label: 'camera2 2, facing back' }, { kind: 'videoinput', deviceId: 'a1', label: 'camera2 1, facing front' },
      { kind: 'videoinput', deviceId: 'a0', label: 'camera2 0, facing back' }, { kind: 'videoinput', deviceId: 'a3', label: 'camera2 3, facing back' },
    ];
    assert.deepEqual([pickCamera(android, 'environment'), pickCamera(android, 'user'), ultraWideOf(android, 'environment')], ['a0', 'a1', null], 'the lowest number on a side is the main lens');
    assert.equal(pickCamera([{ kind: 'videoinput', deviceId: 'x', label: '' }], 'user'), null, 'no labels before permission: the side is asked for instead');
    assert.equal(pickCamera([{ kind: 'videoinput', deviceId: 'w', label: 'Integrated Webcam' }], 'environment'), null);
  });
});

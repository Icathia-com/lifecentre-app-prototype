// The launch pop-up: when it shows (the switch, the live slot, its start and end) and the once-a-day memory on the phone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { popupShowing, seenToday, safeImage } from '../js/popup.js';

const NOW = Date.parse('2026-11-03T02:00:00Z'); // 10:00 on 3 Nov in Singapore
const popup = (extra = {}) => ({ id: 'p1', title: 'Christmas', image: 'https://pub.r2.dev/popups/a.jpg', start: NOW - 3600000, end: NOW + 86400000, status: 'live', ...extra });
const on = { popupsOn: true, livePopupId: 'p1' };

describe('when the launch pop-up shows', () => {
  it('shows only while the switch is on, the pop-up is the one in the slot, live or scheduled, and between its start and end', () => {
    assert.equal(popupShowing({ config: on, popup: popup(), now: NOW }), true);
    assert.equal(popupShowing({ config: on, popup: popup({ status: 'approved' }), now: NOW }), true);
    assert.equal(popupShowing({ config: { ...on, popupsOn: false }, popup: popup(), now: NOW }), false, 'the master switch is off');
    assert.equal(popupShowing({ config: { ...on, livePopupId: 'other' }, popup: popup(), now: NOW }), false, 'not the one in the slot');
    assert.equal(popupShowing({ config: on, popup: popup({ status: 'ended' }), now: NOW }), false);
    assert.equal(popupShowing({ config: on, popup: popup({ status: 'requested' }), now: NOW }), false);
    assert.equal(popupShowing({ config: on, popup: popup({ start: NOW + 1 }), now: NOW }), false, 'not started');
    assert.equal(popupShowing({ config: on, popup: popup({ end: NOW }), now: NOW }), false, 'ended at this very moment');
    assert.equal(popupShowing({ config: on, popup: null, now: NOW }), false);
    assert.equal(popupShowing({ config: null, popup: popup(), now: NOW }), false);
  });
  it('remembers the day it was shown, by the Singapore date', () => {
    assert.equal(seenToday({ id: 'p1', day: '2026-11-03' }, 'p1', NOW), true);
    assert.equal(seenToday({ id: 'p1', day: '2026-11-02' }, 'p1', NOW), false, 'yesterday');
    assert.equal(seenToday({ id: 'p0', day: '2026-11-03' }, 'p1', NOW), false, 'a different pop-up');
    assert.equal(seenToday(null, 'p1', NOW), false);
    assert.equal(seenToday({ id: 'p1', day: '2026-11-03' }, 'p1', Date.parse('2026-11-03T16:30:00Z')), false, 'past midnight in Singapore is a new day');
  });
  it('lets only https pictures or the event JPEG reach the screen', () => {
    assert.equal(safeImage('https://pub.r2.dev/popups/a.jpg'), 'https://pub.r2.dev/popups/a.jpg');
    assert.equal(safeImage('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
    assert.equal(safeImage('http://example.org/a.jpg'), '');
    assert.equal(safeImage('javascript:alert(1)'), '');
    assert.equal(safeImage('data:text/html;base64,PHNjcmlwdD4='), '');
    assert.equal(safeImage(undefined), '');
  });
});

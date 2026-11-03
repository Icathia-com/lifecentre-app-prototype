// The Home greeting: time of day in Singapore, first names, and the lines and sentence it builds.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { greetingFor, msUntilGreetingChange, firstName, greetingLines } from '../js/greeting.js';
import { dayStart } from '../js/util.js';

const HOUR = 3600000;
const at = (hour, minute = 0, second = 0) => dayStart('2026-11-03') + ((hour * 60 + minute) * 60 + second) * 1000; // Tuesday 3 Nov 2026, Singapore

describe('the Home greeting', () => {
  it('follows the Singapore clock: morning from 5am, afternoon from noon, evening from 6pm until 5am', () => {
    const times = [at(4, 59, 59), at(5), at(11, 59, 59), at(12), at(17, 59, 59), at(18), at(23, 59, 59), at(0)];
    assert.deepEqual(times.map((ms) => greetingFor(ms)), ['Good evening', 'Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening', 'Good evening']);
  });
  it('knows how long until the greeting next changes', () => {
    assert.equal(msUntilGreetingChange(at(9)), 3 * HOUR);
    assert.equal(msUntilGreetingChange(at(11, 59, 59)), 1000);
    assert.equal(msUntilGreetingChange(at(12)), 6 * HOUR);
    assert.equal(msUntilGreetingChange(at(18)), 11 * HOUR);
    assert.equal(msUntilGreetingChange(at(23)), 6 * HOUR);
    assert.equal(msUntilGreetingChange(at(2)), 3 * HOUR);
  });
  it('takes the first word of a name', () => {
    assert.deepEqual(['Theersha test', '  Samuel  Tan ', 'Grace', '', null, undefined].map(firstName), ['Theersha', 'Samuel', 'Grace', '', '', '']);
  });
  it('lays out the three lines and the sentence a screen reader hears', () => {
    assert.deepEqual(greetingLines({ name: 'Theersha test', ms: at(9) }), { light: 'Good morning', bold: 'Theersha', date: 'Tue, Nov 3', sentence: 'Good morning, Theersha. Tuesday, 3 November' });
    assert.deepEqual(greetingLines({ name: '', ms: at(20) }), { light: 'Good', bold: 'evening', date: 'Tue, Nov 3', sentence: 'Good evening. Tuesday, 3 November' });
    assert.deepEqual(greetingLines({ ms: at(13) }), { light: 'Good', bold: 'afternoon', date: 'Tue, Nov 3', sentence: 'Good afternoon. Tuesday, 3 November' });
  });
});

// The greeting at the top of Home: the time of day in Singapore, the person's first name, and the sentence a screen reader hears.
import { dateKey, dayStart, formatDay } from './util.js';

const HOUR = 3600000;
const CHANGES = [5, 12, 18, 29]; // the hours (Singapore) when the greeting changes: 5am, noon, 6pm, and 5am the next day
const sinceMidnight = (ms) => ms - dayStart(dateKey(ms));

// "Good morning" from 5am, "Good afternoon" from noon, "Good evening" from 6pm until 5am.
export function greetingFor(ms = Date.now()) {
  const hour = sinceMidnight(ms) / HOUR;
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Milliseconds until the greeting next changes.
export function msUntilGreetingChange(ms = Date.now()) {
  const since = sinceMidnight(ms);
  return CHANGES.map((hour) => hour * HOUR).find((change) => change > since) - since;
}

// The first word of a name, or '' when there is no name.
export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0];

// The three lines at the top of Home (light, bold, date) and the one sentence a screen reader hears. With a name:
// "Good morning" / "Theersha" / "Tue, Nov 3". Without one, the greeting itself fills the two lines: "Good" / "morning".
export function greetingLines({ name, ms = Date.now() } = {}) {
  const greeting = greetingFor(ms);
  const first = firstName(name);
  const [good, time] = greeting.split(' ');
  return {
    light: first ? greeting : good,
    bold: first || time,
    date: formatDay(ms, { weekday: 'short', month: 'short', day: 'numeric' }, 'en-US'),
    sentence: `${greeting}${first ? `, ${first}` : ''}. ${formatDay(ms, { weekday: 'long' })}, ${formatDay(ms, { day: 'numeric', month: 'long' })}`,
  };
}

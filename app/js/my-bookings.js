// The signed-in member's own room bookings, for their calendar and Day plan.
// Only the member's own bookings are ever asked for: the booking system answers a signed-in member with their own list and nobody else's.
// Without a booking sign-in, or when the booking system cannot be reached, the calendar simply shows no bookings.
import { api, getSession } from './booking-api.js';

const FRESH_MS = 60000;
let cache = null; // { token, at, list }

// Resolves with [{ id, facility, date, start, end, status }] for bookings that are on, or still waiting to be approved.
export async function myBookings({ force = false } = {}) {
  const token = getSession()?.token;
  if (!token) { cache = null; return []; }
  if (!force && cache && cache.token === token && Date.now() - cache.at < FRESH_MS) return cache.list;
  try {
    const r = await api('myBookings');
    const list = [...(r.upcoming ?? []), ...(r.past ?? [])]
      .filter((b) => ['Approved', 'Requested', 'Needs information'].includes(b.status) && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end))
      .map((b) => ({ id: b.id, facility: String(b.facility), date: b.date, start: b.start, end: b.end, status: b.status }));
    cache = { token, at: Date.now(), list };
    return list;
  } catch {
    return cache?.token === token ? cache.list : [];
  }
}

export const forgetMyBookings = () => { cache = null; };

// Talks to the church's booking system (the Apps Script web app behind the Sheet and the booking calendar).
// The address is public by design: every call except the two sign-in calls needs a live member code session.
// Calls are POSTed as text/plain, which browsers send across sites without a preflight request.
export const BOOKING_API = 'https://script.google.com/macros/s/AKfycbwjt1Zjtw88lXoP9MZ9zTSMMksigfKW8p1PWAF-20WOjsKUOiwdRAjC4PtonaSFLGcS/exec';

const SESSION_KEY = 'lc:v1:booking-session';
const TIMEOUT_MS = 45000;

export class BookingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// The signed-in member on this phone: { token, name, email }.
export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && /^[0-9a-f]{64}$/.test(s.token) ? s : null;
  } catch { return null; }
}
// Screens that show who is signed in (the Home avatar, the Account page) listen for changes here.
const CHANGED = 'lc:booking-session';
const announce = () => { try { window.dispatchEvent(new Event(CHANGED)); } catch { /* not in a browser */ } };
export function setSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ } announce(); }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } announce(); }
export function onBookingSession(fn) {
  const run = () => fn(getSession());
  window.addEventListener(CHANGED, run);
  run();
  return () => window.removeEventListener(CHANGED, run);
}

// Resolves with the answer's fields, or throws a BookingError. A "signin" error also forgets the saved session.
export async function api(action, fields = {}, { auth = true } = {}) {
  const token = auth ? getSession()?.token : undefined;
  if (auth && !token) throw new BookingError('signin', 'Please sign in again.');
  let json;
  try {
    const res = await fetch(BOOKING_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...(token ? { token } : {}), ...fields }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    json = await res.json();
  } catch {
    throw new BookingError('network', 'Could not reach the booking system. Check your connection and try again.');
  }
  if (!json || json.ok !== true) {
    if (json?.code === 'signin') clearSession();
    throw new BookingError(json?.code ?? 'error', json?.error ?? 'Something went wrong. Please try again.');
  }
  return json;
}

// Staff signed in with Google get a booking session without an emailed code: the booking system checks the Google
// sign-in itself (it is sent the Google ID token, verifies it with Google and looks the email up on its own lists).
// Resolves with the session, or null when nobody is signed in with Google. Throws a BookingError when the booking
// system says no (code "notstaff" when the Google account is not on its lists).
export async function sessionFromGoogle() {
  const { getAuthTools } = await import('./firebase.js');
  const tools = await getAuthTools();
  const user = tools.auth.currentUser ?? await new Promise((resolve) => {
    const stop = tools.onAuthStateChanged(tools.auth, (u) => { stop(); resolve(u); });
  });
  if (!user) return null;
  const idToken = await user.getIdToken();
  const r = await api('staffSignIn', { idToken }, { auth: false });
  const session = { token: r.token, name: r.user.name, email: r.user.email };
  setSession(session);
  return session;
}

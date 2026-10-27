// Who is signed in with Google (staff accounts only) and what role they have on the staff list.
// Members use the emailed-code sign-in for bookings instead, so they are treated like visitors here.
// The role is only used to choose what to show; the security rules decide what anyone may actually do.
import { data, getAuthTools } from './firebase.js';

const KEY = 'lc:v1:session'; // last known account, so the tab bar is right on the first paint
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = (value) => { try { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); } catch { /* storage may be blocked */ } };

let state = read(); // { email, role } or null
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));

export const STAFF_ROLES = ['admin', 'staff', 'leader'];
export const isOnStaffList = (session) => STAFF_ROLES.includes(session?.role);

export function onSession(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export async function startSession() {
  try {
    const tools = await getAuthTools();
    tools.onAuthStateChanged(tools.auth, async (user) => {
      if (!user) { state = null; write(null); emit(); return; }
      try {
        const entry = await data.admin.getStaffEntry(user.email);
        state = { email: user.email, role: entry ? entry.role : null };
      } catch {
        // Offline or refused: keep what was known for this same account.
        if (!state || state.email !== user.email) state = { email: user.email, role: null };
      }
      write(state);
      emit();
    });
  } catch (error) {
    console.warn('Could not start sign-in:', error.message); // keep the saved state
  }
}

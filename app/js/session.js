// Who is signed in with Google (staff accounts only) and what role they have on the staff list.
// Members use the emailed-code sign-in for bookings instead, so they are treated like visitors here.
// The role is only used to choose what to show; the security rules decide what anyone may actually do.
import { data, getAuthTools } from './firebase.js';

const KEY = 'lc:v1:session'; // last known account, so the tab bar is right on the first paint
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = (value) => { try { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); } catch { /* storage may be blocked */ } };

let state = read(); // { email, role, name, approvePopups, postStories, displayName, photo } or null (name: Google's display name, for the greeting)

// After the person changes their own display name or photo on the Account page: the app sees it at once.
export function updateProfile({ displayName, photo }) {
  if (!state) return;
  state = { ...state, displayName: displayName || state.name || '', photo: photo || '' };
  write(state);
  emit();
}
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
    let ticket = 0; // a sign-out during the staff-list check must not be overwritten by that check's late answer
    tools.onAuthStateChanged(tools.auth, async (user) => {
      const mine = ++ticket;
      if (!user) { state = null; write(null); emit(); return; }
      const email = user.email.toLowerCase(); // as the security rules compare it
      try {
        const entry = await data.admin.getStaffEntry(email);
        if (mine !== ticket) return;
        state = {
          email, role: entry ? entry.role : null, name: user.displayName || '', approvePopups: !!entry?.approvePopups,
          postStories: entry?.role === 'admin' || !!entry?.postStories, // stories: the display name and photo the person set, else Google's
          displayName: entry?.displayName || user.displayName || '', photo: entry?.photo || user.photoURL || '',
        };
      } catch {
        if (mine !== ticket) return;
        // Offline or refused: keep what was known for this same account.
        if (!state || state.email !== email) state = { email, role: null, name: user.displayName || '', approvePopups: false, postStories: false, displayName: user.displayName || '', photo: user.photoURL || '' };
      }
      write(state);
      emit();
    });
  } catch (error) {
    console.warn('Could not start sign-in:', error.message); // keep the saved state
  }
}

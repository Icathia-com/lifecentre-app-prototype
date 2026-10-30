// Account page, opened from the avatar on Home.
// Signed out: member sign-in (emailed code) and staff sign-in (Google).
// Signed in: who is signed in, with what role, sign out or switch account, and the staff or admin tools for that role.
// Members and staff sign in separately (members for bookings, staff for posting), so each sign-in has its own row.
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { getAuthTools } from '../firebase.js';
import { onSession } from '../session.js';
import { api, clearSession, onBookingSession } from '../booking-api.js';
import { forgetMyBookings } from '../my-bookings.js';
import { memberSignIn } from '../member-signin.js';

const ROLE = { admin: 'Admin', staff: 'Staff', leader: 'Leader' };

// What each role can open from here. The security rules still decide what anyone may actually do.
const TOOLS = {
  admin: [
    ['#/staff', 'Notices, verses, events and the staff list'],
    ['#/events/new', 'Create an event'],
    ['#/watch', 'Post a video'],
    ['#/booking', 'Facilities booking'],
  ],
  staff: [
    ['#/staff', 'Notices, verses and events'],
    ['#/events/new', 'Create an event'],
    ['#/booking', 'Facilities booking'],
  ],
  leader: [
    ['#/watch', 'Post a video'],
    ['#/booking', 'Facilities booking'],
  ],
};

// Where to go back to after signing in (only screens of this app, by name).
const NEXT = { booking: '#/booking' };

export function render(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const next = NEXT[query.get('next')] ?? null;
  const ended = query.get('ended') === '1';
  const noGoogle = query.get('nogoogle') === '1'; // staff whose Google account the booking system did not accept
  let staff = null; // { email, role } from the Google sign-in, or null
  let member = null; // { token, name, email } from the emailed-code sign-in, or null
  let signin = null; // the member sign-in form, kept between redraws so what was typed survives
  let showMemberForm = !!next; // arriving from booking: the member form is open straight away
  let googleError = '';
  let busy = false;

  const host = h('div', { class: 'stack' });
  root.append(host);

  const initial = () => ((member?.name || member?.email || staff?.email || '').trim()[0] || '').toUpperCase();

  async function staffSignIn() {
    googleError = '';
    try {
      const tools = await getAuthTools();
      await tools.signInWithGoogle();
    } catch (err) {
      if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) return;
      googleError = `Could not sign in: ${err.message}`;
      draw();
    }
  }

  async function staffSignOut() {
    try { const tools = await getAuthTools(); await tools.signOut(tools.auth); } catch (err) { console.warn(err); }
  }

  async function memberSignOut() {
    try { await api('signOut'); } catch { /* the session is forgotten on this phone either way */ }
    clearSession();
    forgetMyBookings();
  }

  async function signOutAll() {
    if (busy) return;
    busy = true; draw();
    await Promise.all([member ? memberSignOut() : null, staff ? staffSignOut() : null]);
    busy = false; showMemberForm = false; signin = null;
    draw();
  }

  const memberForm = () => {
    signin ??= memberSignIn({
      intro: 'We’ll email you a 6‑digit code. No password needed.',
      notice: ended ? 'Your sign-in ended. Please sign in again.' : noGoogle ? 'Your Google account is not set up for bookings yet. Sign in with your email code instead.' : '',
      onDone: () => { signin = null; showMemberForm = false; if (next) location.replace(next); },
    });
    return signin.el;
  };

  const googleButton = () => h('button', { type: 'button', class: 'btn acct-google', onclick: staffSignIn }, 'Staff sign-in with Google');
  const googleAlert = () => (googleError ? h('p', { class: 'note bk-error', role: 'alert' }, googleError) : null);

  function signedOutView() {
    return [
      h('section', { class: 'bk-frame', 'aria-labelledby': 'acct-member-h' }, h('div', { class: 'bk-inner' },
        h('h2', { id: 'acct-member-h', class: 'big' }, 'Sign in'),
        memberForm())),
      h('section', { class: 'card', 'aria-labelledby': 'acct-staff-h' },
        h('h2', { id: 'acct-staff-h', class: 'label' }, 'Staff'),
        googleButton(),
        googleAlert()),
    ];
  }

  const bookingsCard = () => h('section', { class: 'card', 'aria-labelledby': 'acct-add-member-h' },
    h('h2', { id: 'acct-add-member-h', class: 'label' }, 'Bookings'),
    showMemberForm ? memberForm() : h('button', { type: 'button', class: 'btn', onclick: () => { showMemberForm = true; draw(); host.querySelector('#bk-email')?.focus(); } }, 'Sign in for bookings'));

  function signedInView() {
    const name = member?.name || staff?.email || member?.email || '';
    const rows = [];
    if (member) {
      rows.push(h('div', { class: 'acct-row' },
        h('span', { class: 'acct-what' }, h('b', {}, 'Member'), h('small', {}, member.email)),
        h('button', { type: 'button', class: 'btn', disabled: busy ? '' : null, onclick: memberSignOut }, 'Sign out')));
    }
    if (staff) {
      rows.push(h('div', { class: 'acct-row' },
        h('span', { class: 'acct-what' }, h('b', {}, ROLE[staff.role] ?? 'Not on the staff list'), h('small', {}, staff.email)),
        h('button', { type: 'button', class: 'btn', disabled: busy ? '' : null, onclick: staffSignOut }, 'Sign out')));
    }

    const tools = TOOLS[staff?.role];
    const toolsTitle = staff?.role === 'admin' ? 'Admin tools' : 'Staff tools';

    return [
      h('section', { class: 'card acct-me', 'aria-label': 'Signed in' },
        h('div', { class: 'acct-who' },
          h('span', { class: 'acct-av', 'aria-hidden': 'true' }, initial()),
          h('b', { class: 'acct-name' }, name)),
        h('div', { class: 'acct-rows' }, rows),
        member && staff ? h('button', { type: 'button', class: 'btn', disabled: busy ? '' : null, onclick: signOutAll }, busy ? 'Signing out…' : 'Sign out of both') : null),

      next && !member ? bookingsCard() : null,

      tools ? h('section', { class: 'card acct-tools', 'aria-labelledby': 'acct-tools-h' },
        h('h2', { id: 'acct-tools-h', class: 'label' }, toolsTitle),
        h('nav', { class: 'acct-links', 'aria-label': toolsTitle },
          tools.map(([href, label]) => h('a', { href }, h('span', {}, label), ic('right', 18, 2.2))))) : null,

      !member && !next ? bookingsCard() : null,

      !staff ? h('section', { class: 'card', 'aria-labelledby': 'acct-add-staff-h' },
        h('h2', { id: 'acct-add-staff-h', class: 'label' }, 'Staff'),
        googleButton(),
        googleAlert()) : null,
    ];
  }

  function draw() {
    fill(host,
      h('header', { class: 'bk-head' },
        h('div', { class: 'bk-head-top' }, h('a', { class: 'round-btn', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2))),
        h('h1', { id: 'page-title', tabindex: '-1' }, 'Account')),
      member || staff ? signedInView() : signedOutView(),
      h('a', { class: 'bk-contact acct-contact', href: '#/contact' }, h('span', {}, 'Need help?'), h('b', {}, 'Contact us')));
  }

  let firstSession = true;
  const stopStaff = onSession((s) => {
    const was = staff;
    staff = s?.email ? s : null;
    if (staff) googleError = '';
    if (!firstSession && !was && staff && next && !noGoogle) { location.replace(next); return; }
    firstSession = false;
    draw();
  });
  const stopMember = onBookingSession((m) => { member = m; draw(); });

  return () => { stopStaff(); stopMember(); };
}

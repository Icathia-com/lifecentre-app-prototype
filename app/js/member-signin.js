// The member sign-in form (an emailed 6-digit code), shared by the Account page and Facilities booking.
// Once a code is sent for checking, the code box and buttons are locked until the answer comes back.
// They open again only if the code is wrong or has expired, so a new code can be typed or asked for.
import { h, fill } from './util.js';
import { api, setSession } from './booking-api.js';
import { forgetMyBookings } from './my-bookings.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// onDone(user) runs after a successful sign-in. `notice` is an optional message shown above the form (for example "Your sign-in ended");
// `intro` is the line shown before a code is asked for.
export function memberSignIn({ onDone, notice: firstNotice = '', intro = '' } = {}) {
  let step = 'email'; // email | code
  let email = '';
  let notice = firstNotice;
  let error = '';
  let typed = ''; // what is in the code box
  let busy = false; // 'send' while asking for a code, 'check' while a code is being checked

  const el = h('div', { class: 'ms' });

  async function sendCode() {
    if (busy) return;
    if (!EMAIL.test(email.trim())) { error = 'Enter a valid email address.'; draw(); return; }
    busy = 'send'; error = ''; draw();
    try {
      const r = await api('requestCode', { email: email.trim() }, { auth: false });
      step = 'code'; notice = r.message;
    } catch (e) { error = e.message; }
    busy = false; draw();
  }

  async function verify(raw) {
    if (busy) return;
    const code = String(raw).replace(/\D/g, ''); // a pasted code may carry spaces or line breaks
    if (!/^\d{6}$/.test(code)) { error = 'Enter the 6-digit code from the email.'; draw(); return; }
    busy = 'check'; error = ''; draw();
    try {
      const r = await api('verifyCode', { email: email.trim(), code }, { auth: false });
      const user = { token: r.token, name: r.user.name, email: r.user.email };
      setSession(user);
      forgetMyBookings();
      busy = false;
      onDone?.(user);
      return;
    } catch (e) {
      error = e.message; // wrong or expired: empty the box and open it again for a new code
      typed = '';
    }
    busy = false; draw();
  }

  const field = (label, control) => h('label', { class: 'bk-field' }, h('span', {}, label), control);

  function draw() {
    const second = step === 'code';
    const locked = busy === 'check';
    const emailInput = h('input', { id: 'bk-email', type: 'email', autocomplete: 'email', inputmode: 'email', value: email, readonly: second || busy ? '' : null, oninput: (e) => { email = e.target.value; } });
    const codeInput = second ? h('input', {
      id: 'bk-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '12',
      value: typed, readonly: locked ? '' : null, 'aria-busy': locked ? 'true' : null, oninput: (e) => { typed = e.target.value; },
    }) : null;
    fill(el,
      !second && !notice && intro ? h('p', { class: 'muted' }, intro) : null,
      notice ? h('p', { class: second ? 'muted' : 'note', role: 'status' }, notice) : null,
      h('form', { class: 'bk-form', novalidate: '', onsubmit: (e) => { e.preventDefault(); if (second) { typed = codeInput.value; verify(typed); } else sendCode(); } },
        field('Email address', emailInput),
        second ? field('6-digit code', codeInput) : null,
        error ? h('p', { class: 'note bk-error', role: 'alert' }, error) : null,
        h('button', { type: 'submit', class: 'cr-submit', disabled: busy ? '' : null },
          busy === 'check' ? 'Checking…' : busy === 'send' ? 'Please wait…' : second ? 'Sign in' : 'Send my code'),
        second ? h('div', { class: 'bk-links' },
          h('button', { type: 'button', class: 'link', disabled: busy ? '' : null, onclick: () => { step = 'email'; notice = ''; error = ''; typed = ''; draw(); el.querySelector('#bk-email')?.focus(); } }, 'Use a different email'),
          h('button', { type: 'button', class: 'link', disabled: busy ? '' : null, onclick: () => { typed = ''; sendCode(); } }, 'Send a new code')) : null));
    if (second && !busy) el.querySelector('#bk-code')?.focus();
  }

  draw();
  return { el, get step() { return step; } };
}

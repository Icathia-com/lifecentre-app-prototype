// Edit profile: the photo (camera or the phone's pictures, cropped to a circle), the banner (cropped wide), the display name,
// a bio or Bible verse of up to 150 characters and the birthday as day and month only. Saved on this phone, with the pictures
// made small. Someone with "Can post stories" also has their display name and photo saved to their staff entry, the photo
// going through the upload Worker, so their story circle uses them. Nothing else is sent anywhere.
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { data } from '../firebase.js';
import { onSession, updateProfile } from '../session.js';
import { load, save } from '../local.js';
import { uploadFile } from '../uploads.js';
import { openCropper } from '../cropper.js';
import { PROFILE_KEY, LIMITS, MONTHS, PHOTO_SIZE, BANNER_SIZE, cleanProfile, cleanBirthday, daysInMonth } from '../profile.js';
import { profileAvatar } from './profile.js';

export function render(root) {
  const saved = cleanProfile(load(PROFILE_KEY, {}));
  const draft = { ...saved, birthday: saved.birthday ? { ...saved.birthday } : null };
  let staff = null;
  let busy = false;
  const status = h('p', { class: 'note', role: 'status' });
  const host = h('div', { class: 'pf pf-editing' });
  root.append(host);

  async function pick(input, kind) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const picture = kind === 'photo'
        ? await openCropper({ file, shape: 'circle', width: PHOTO_SIZE, height: PHOTO_SIZE, title: 'Profile photo' })
        : await openCropper({ file, shape: 'wide', width: BANNER_SIZE.width, height: BANNER_SIZE.height, title: 'Banner', quality: 0.8 });
      if (picture) { draft[kind] = picture; draw(); host.querySelector(kind === 'photo' ? '.pf-ed-photo-btn' : '.pf-ed-banner-btn')?.focus(); }
    } catch { status.textContent = 'That picture could not be used.'; }
  }

  const fileInput = (id, kind, label, capture) => h('input', { type: 'file', id, accept: 'image/*', capture: capture || null, class: 'sr', tabindex: '-1', 'aria-label': label, onchange: (e) => pick(e.target, kind) });

  function draw() {
    const banner = h('div', { class: 'pf-banner' });
    if (draft.banner) banner.style.backgroundImage = `url("${draft.banner}")`;
    const count = h('span', { class: 'pf-count', 'aria-live': 'polite' }, `${draft.bio.length}/${LIMITS.bio}`);
    const day = h('select', { id: 'pf-day', 'aria-label': 'Day', onchange: (e) => { setBirthday(e.target.value, monthSel.value); } },
      h('option', { value: '' }, 'Day'),
      Array.from({ length: daysInMonth(draft.birthday?.month || 1) }, (_, k) => h('option', { value: String(k + 1), selected: draft.birthday?.day === k + 1 }, String(k + 1))));
    const monthSel = h('select', { id: 'pf-month', 'aria-label': 'Month', onchange: (e) => { setBirthday(day.value, e.target.value); draw(); host.querySelector('#pf-month')?.focus(); } },
      h('option', { value: '' }, 'Month'),
      MONTHS.map((m, k) => h('option', { value: String(k + 1), selected: draft.birthday?.month === k + 1 }, m)));
    fill(host,
      h('div', { class: 'pf-cover' }, banner,
        h('div', { class: 'pf-top' },
          h('a', { class: 'round-btn', href: '#/profile', 'aria-label': 'Cancel' }, ic('close', 20, 2.2)),
          h('button', { type: 'button', class: 'round-btn pf-ed-banner-btn', 'aria-label': 'Change banner', onclick: () => host.querySelector('#pf-banner-file').click() }, ic('image', 20, 2))),
        fileInput('pf-banner-file', 'banner', 'Banner picture')),
      h('div', { class: 'pf-head' },
        profileAvatar(draft, staff, 104),
        h('h1', { id: 'page-title', tabindex: '-1' }, 'Edit profile'),
        h('div', { class: 'pf-ed-photo', role: 'group', 'aria-label': 'Profile photo' },
          h('button', { type: 'button', class: 'btn pf-ed-photo-btn', onclick: () => host.querySelector('#pf-photo-camera').click() }, ic('camera', 16, 2), 'Camera'),
          h('button', { type: 'button', class: 'btn', onclick: () => host.querySelector('#pf-photo-file').click() }, ic('image', 16, 2), 'Photos'),
          fileInput('pf-photo-camera', 'photo', 'Take a photo', 'user'), fileInput('pf-photo-file', 'photo', 'Choose a photo'))),
      h('form', { class: 'form pf-form', onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'field' }, h('label', { for: 'pf-name' }, 'Display name'),
          h('input', { type: 'text', id: 'pf-name', maxlength: String(LIMITS.name), autocomplete: 'nickname', value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
        h('div', { class: 'field' }, h('label', { for: 'pf-bio' }, 'Bio or Bible verse'),
          h('textarea', { id: 'pf-bio', maxlength: String(LIMITS.bio), rows: '3', oninput: (e) => { draft.bio = e.target.value.slice(0, LIMITS.bio); count.textContent = `${draft.bio.length}/${LIMITS.bio}`; } }, draft.bio),
          count),
        h('fieldset', { class: 'field pf-birthday' }, h('legend', {}, 'Birthday'), h('div', { class: 'pf-bd-row' }, day, monthSel)),
        h('div', { class: 'form-actions' },
          h('button', { type: 'submit', class: 'btn primary', disabled: busy ? '' : null }, busy ? 'Saving…' : 'Save'),
          h('a', { class: 'btn', href: '#/profile' }, 'Cancel')),
        status));
  }
  function setBirthday(d, m) {
    if (!m && !d) { draft.birthday = null; return; }
    const month = Number(m) || null;
    let dd = Number(d) || null;
    if (month && dd && dd > daysInMonth(month)) dd = daysInMonth(month);
    draft.birthday = { day: dd, month };
  }

  async function submit() {
    if (busy) return;
    if (draft.birthday && !cleanBirthday(draft.birthday)) { status.textContent = 'Please choose both the day and the month of your birthday.'; return; }
    const next = cleanProfile(draft);
    save(PROFILE_KEY, next);
    // People who post stories: their name and photo on their stories too.
    if (staff?.postStories && (next.name !== saved.name || next.photo !== saved.photo)) {
      busy = true; draw(); status.textContent = 'Saving…';
      try {
        let photo = staff.photo || '';
        if (next.photo && next.photo !== saved.photo) photo = await uploadFile(await (await fetch(next.photo)).blob(), { kind: 'avatars' });
        const displayName = next.name || staff.displayName || staff.name || '';
        await data.admin.updateMe(staff.email, { displayName, photo });
        updateProfile({ displayName, photo });
      } catch (err) {
        busy = false; draw();
        status.textContent = `Saved on this phone. Your stories could not be updated: ${err.code === 'permission-denied' ? 'this account is not on the staff list.' : err.message}`;
        return;
      }
    }
    location.hash = '#/profile';
  }

  const stop = onSession((s) => { staff = s?.email ? s : null; if (!busy) draw(); });
  return () => stop();
}

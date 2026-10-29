// Giving via PayNow: the intro, the scam warning, and one card per PayNow account with its UEN and a Copy button.
// The official QR codes are not in the app yet (decided 27 Oct), so each card keeps an empty QR space.
// Layout follows design/Giving.dc.html.
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { FUNDS } from '../sites.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard blocked (some browsers, insecure pages): fall back to selecting a hidden field.
    const field = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', readonly: '', style: 'position:fixed;opacity:0;left:-9999px' });
    field.value = text;
    document.body.append(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    field.remove();
    return ok;
  }
}

function fundCard(fund, status) {
  const label = h('span', null, 'Copy');
  const button = h('button', { type: 'button', class: 'gv-copy', 'aria-label': `Copy the UEN number for ${fund.title}` }, ic('copy', 16, 2), label);
  let timer = 0;
  button.addEventListener('click', async () => {
    const ok = await copyText(fund.uen);
    clearTimeout(timer);
    button.classList.toggle('done', ok);
    label.textContent = ok ? 'Copied' : 'Copy failed';
    status.textContent = ok ? `${fund.title} UEN copied` : 'Could not copy. Select the number and copy it by hand.';
    timer = setTimeout(() => { button.classList.remove('done'); label.textContent = 'Copy'; status.textContent = ''; }, 2000);
  });
  return h('section', { class: 'card gv-fund', 'aria-label': fund.title },
    h('h2', { class: 'gv-title' }, fund.title),
    h('div', { class: 'gv-line' },
      h('span', { class: 'gv-line-text' }, h('span', { class: 'gv-small' }, 'UEN No.'), h('span', { class: 'gv-uen' }, fund.uen)),
      button),
    h('div', { class: 'gv-qr-wrap' },
      h('span', { class: 'gv-small' }, 'QR Code'),
      h('div', { class: 'gv-qr', role: 'img', 'aria-label': 'Space for the official PayNow QR code' }, ic('qr', 34, 1.6))),
    h('div', { class: 'gv-line gv-ref' }, h('span', { class: 'gv-line-text' }, h('span', { class: 'gv-small' }, 'Reference number / Description'), h('span', { class: 'gv-ref-text' }, 'Your contact number'))),
    h('p', { class: 'gv-foot' }, 'If your contact number is not entered, the giving will be recorded as anonymous.'));
}

export function render(root) {
  const status = h('p', { class: 'sr', role: 'status' });
  fill(root,
    h('header', { class: 'screen-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Giving', ' ', h('span', { class: 'light' }, 'via PayNow'))),
    h('p', { class: 'gv-intro' }, "If you have an online banking account, you may use your bank's mobile app to give your tithes and offerings via PayNow UENs (unique entity number) or PayNow QR (Quick Response) codes."),
    h('div', { class: 'gv-warn', role: 'note' },
      h('span', { class: 'gv-warn-ic' }, ic('shield', 22, 2)),
      h('div', { class: 'gv-warn-text' },
        h('p', null, h('b', null, 'Important:'), ' to avoid scams, please only use the QR codes from our official sources (website, tithe/offering envelopes) and check that you are giving to:'),
        h('ul', null, h('li', null, 'Life Centre - Tithes & Offering'), h('li', null, 'Life Centre - Building Fund')),
        h('p', null, 'Please also ensure that the UEN number is correct.'))),
    FUNDS.map((fund) => fundCard(fund, status)),
    h('p', { class: 'gv-source' }, 'Source: lifecentre.sg'),
    status);
}

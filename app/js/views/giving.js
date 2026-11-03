// Giving via PayNow: the intro, the scam warning, and one card per PayNow account with its UEN and a Copy button.
// Each card shows the church's official PayNow QR code (app/images), matched to the fund by its UEN. A fund with no picture keeps an empty QR space.
// Layout follows design/Giving.dc.html.
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { FUNDS } from '../sites.js';
import { GIVING_TEXT } from '../giving-text.js';

// The official codes, redrawn sharp from the church's own. Each one decodes to the UEN of its fund.
const QR_BY_UEN = {
  S87SS0049C: { src: 'images/paynow-tithes.png', file: 'life-centre-paynow-tithes-offering.png' },
  S87SS0049CBLD: { src: 'images/paynow-building.png', file: 'life-centre-paynow-building-fund.png' },
};

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

// A Copy button that says "Copied" for two seconds. `noun` is what is copied, `short` is how the announcement names it.
function copyButton(value, noun, short, owner, status) {
  const label = h('span', null, 'Copy');
  const button = h('button', { type: 'button', class: 'gv-copy', 'aria-label': `Copy the ${noun} for ${owner}` }, ic('copy', 16, 2), label);
  let timer = 0;
  button.addEventListener('click', async () => {
    const ok = await copyText(value);
    clearTimeout(timer);
    button.classList.toggle('done', ok);
    label.textContent = ok ? 'Copied' : 'Copy failed';
    button.setAttribute('aria-label', `${ok ? 'Copied' : 'Copy failed for'} the ${noun} for ${owner}`);
    status.textContent = ok ? `${owner} ${short} copied` : 'Could not copy. Select the number and copy it by hand.';
    timer = setTimeout(() => { button.classList.remove('done'); label.textContent = 'Copy'; button.setAttribute('aria-label', `Copy the ${noun} for ${owner}`); status.textContent = ''; }, 2000);
  });
  return button;
}

// Save QR code and Share, under each code. Save downloads the PNG under a clear file name, except on an iPhone or iPad, where the
// share sheet is the place with "Save Image" (Android's share sheet has no save option, so it is never used for saving). Share opens
// the share sheet with the same file, for sending the code to someone. A cancelled share sheet does nothing.
const onApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function qrButtons(fund, qr, status) {
  let file = null;
  // Fetched ahead of the tap: a phone only opens the share sheet straight after a tap.
  const ready = fetch(qr.src).then((r) => r.blob()).then((blob) => { file = new File([blob], qr.file, { type: 'image/png' }); return file; }).catch(() => null);
  const note = h('p', { class: 'gv-note' });
  let timer = 0;
  const say = (text) => { // shown under the buttons, and read out through the page's status line
    note.textContent = text;
    status.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { note.textContent = ''; status.textContent = ''; }, 4000);
  };
  const png = async () => {
    const f = file ?? await ready;
    if (!f) say('Could not load the QR code. Please try again.');
    return f;
  };
  const share = async (f) => { // true once the share sheet has opened, even if the person then cancels it
    if (!navigator.canShare?.({ files: [f] })) return false;
    try { await navigator.share({ files: [f] }); } catch (err) { if (err.name !== 'AbortError') return false; }
    return true;
  };
  const download = (f) => {
    const link = h('a', { href: URL.createObjectURL(f), download: qr.file });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    say('Saved to your Downloads');
  };
  const save = h('button', {
    type: 'button', class: 'gv-save',
    onclick: async () => { const f = await png(); if (!f) return; if (onApple() && await share(f)) return; download(f); },
  }, ic('image', 16, 2), 'Save QR code');
  const send = h('button', {
    type: 'button', class: 'gv-share', 'aria-label': `Share the QR code for ${fund.title}`,
    onclick: async () => { const f = await png(); if (!f) return; if (!await share(f)) say('Sharing is not available on this device.'); },
  }, ic('share', 15, 2), 'Share');
  return [h('div', { class: 'gv-qr-actions' }, save, send), note];
}

// Text with **bold** parts.
const rich = (text) => text.split('**').map((part, i) => (i % 2 ? h('b', null, part) : part));

// An expandable section: a real button with aria-expanded opens and closes its panel.
function accordion(id, title, content) {
  const button = h('button', { type: 'button', class: 'gv-acc-btn', id: `gv-${id}-btn`, 'aria-expanded': 'false', 'aria-controls': `gv-${id}-panel` }, h('span', null, title), ic('down', 20, 2.2));
  const panel = h('div', { class: 'gv-acc-panel', id: `gv-${id}-panel`, role: 'region', 'aria-labelledby': `gv-${id}-btn`, hidden: '' }, ...content);
  const set = (open) => { button.setAttribute('aria-expanded', String(open)); panel.hidden = !open; };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  return { el: h('div', { class: 'card gv-acc' }, h('h2', { class: 'gv-title gv-acc-title' }, button), panel), button, set };
}

function bankBody(status) {
  const t = GIVING_TEXT;
  return [
    h('p', null, t.bankIntro),
    h('p', null, ...rich(t.bankAdd)),
    ...t.funds.map((fund) => h('div', { class: 'gv-bank-fund' },
      h('b', { class: 'gv-bank-title' }, fund.title),
      h('span', null, fund.bank),
      h('div', { class: 'gv-line' },
        h('span', { class: 'gv-line-text' }, h('span', { class: 'gv-small' }, 'Account number:'), h('span', { class: 'gv-uen' }, fund.account)),
        copyButton(fund.account, 'account number', 'account number', fund.title, status)),
      h('span', null, fund.payee))),
  ];
}

function cashBody({ toPayNow, toBank }) {
  const t = GIVING_TEXT;
  const inline = (label, onclick) => h('button', { type: 'button', class: 'link gv-inline', onclick }, label);
  const [before, rest] = t.consider.split('PayNow');
  const [middle, after] = rest.split('Internet bank transfer');
  return [
    h('p', null, t.cashIntro),
    h('address', { class: 'gv-address' }, ...t.address.map((line) => h('span', null, line))),
    h('p', null, ...rich(t.important)),
    h('p', null, before, inline('PayNow', toPayNow), middle, inline('Internet bank transfer', toBank), after),
    h('h3', { class: 'gv-sub' }, t.designatedHeading),
    h('ul', { class: 'gv-list' }, ...t.designated.map((line) => h('li', null, line))),
  ];
}

function fundCard(fund, status) {
  const button = copyButton(fund.uen, 'UEN number', 'UEN', fund.title, status);
  const qr = QR_BY_UEN[fund.uen];
  return h('section', { class: 'card gv-fund', 'aria-label': fund.title, tabindex: '-1' },
    h('h2', { class: 'gv-title' }, fund.title),
    h('div', { class: 'gv-line' },
      h('span', { class: 'gv-line-text' }, h('span', { class: 'gv-small' }, 'UEN No.'), h('span', { class: 'gv-uen' }, fund.uen)),
      button),
    h('div', { class: 'gv-qr-wrap' },
      h('span', { class: 'gv-small' }, 'QR Code'),
      qr
        ? h('div', { class: 'gv-qr has-code' }, h('img', { src: qr.src, alt: `PayNow QR code for ${fund.title}`, width: '200', height: '200' }))
        : h('div', { class: 'gv-qr', role: 'img', 'aria-label': 'Space for the official PayNow QR code' }, ic('qr', 34, 1.6)),
      qr ? qrButtons(fund, qr, status) : null),
    h('div', { class: 'gv-line gv-ref' }, h('span', { class: 'gv-line-text' }, h('span', { class: 'gv-small' }, 'Reference number / Description'), h('span', { class: 'gv-ref-text' }, 'Your contact number'))),
    h('p', { class: 'gv-foot' }, 'If your contact number is not entered, the giving will be recorded as anonymous.'));
}

export function render(root) {
  const status = h('p', { class: 'sr', role: 'status' });
  const goTo = (el) => { el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  const bank = accordion('bank', GIVING_TEXT.bankHeading, bankBody(status));
  const cash = accordion('cash', GIVING_TEXT.cashHeading, cashBody({
    toPayNow: () => { const first = root.querySelector('.gv-fund'); goTo(first); first.focus({ preventScroll: true }); },
    toBank: () => { bank.set(true); goTo(bank.el); bank.button.focus({ preventScroll: true }); },
  }));
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
    bank.el,
    cash.el,
    h('p', { class: 'gv-source' }, 'Source: lifecentre.sg'),
    status);
}

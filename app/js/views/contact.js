// Contact us: WhatsApp and Call (when the numbers are known), email, prayer request, service times and a map link.
// Layout follows design/Contact.dc.html.
import { h, fill } from '../util.js';
import { ic } from '../ui.js';
import { CHURCH, SITES, SITE_IDS, telHref, whatsappHref, mapsHref } from '../sites.js';

const TYPE_ORDER = ['service', 'kids', 'youth'];

function reachCard(href, icon, label, number) {
  return h('a', { class: 'ct-reach', href, ...(href.startsWith('https:') ? { target: '_blank', rel: 'noopener' } : {}) },
    h('span', { class: 'ct-dot' }, ic(icon, 18, 1.8)),
    h('span', { class: 'ct-reach-title' }, label),
    h('span', { class: 'ct-reach-sub' }, number));
}

function rowLink(href, title, sub) {
  return h('a', { class: 'ct-row', href },
    h('span', { class: 'ct-row-text' }, h('span', { class: 'ct-row-title' }, title), h('span', { class: 'ct-row-sub' }, sub)),
    ic('right', 18, 2));
}

function siteTimes(site) {
  const lines = TYPE_ORDER.flatMap((type) => site.weekly[type] ?? []);
  return h('section', { class: 'ct-site', 'aria-label': site.name },
    h('h2', null, site.venue),
    h('a', { class: 'ct-addr', href: mapsHref(site.address), target: '_blank', rel: 'noopener' }, ic('pin', 15, 2), site.address),
    h('ul', { class: 'ct-times' }, lines.map((l) => h('li', null,
      h('span', { class: 'ct-time-name' }, l.name),
      h('span', { class: 'ct-time-when' }, `${l.when}, ${l.time}`)))));
}

export function render(root) {
  const whatsapp = whatsappHref(CHURCH.whatsapp);
  const phone = telHref(CHURCH.phone);
  const main = SITES[CHURCH.mainSite];

  const visit = h('div', { id: 'visit', class: 'ct-visit', hidden: '' }, SITE_IDS.map((id) => siteTimes(SITES[id])));
  const visitBtn = h('button', { type: 'button', class: 'ct-row', 'aria-expanded': 'false', 'aria-controls': 'visit', onclick: () => {
    const open = visit.hidden;
    visit.hidden = !open;
    visitBtn.setAttribute('aria-expanded', String(open));
    visitBtn.querySelector('svg').style.transform = open ? 'rotate(90deg)' : '';
    if (open) visit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } },
  h('span', { class: 'ct-row-text' }, h('span', { class: 'ct-row-title' }, 'Plan a visit'), h('span', { class: 'ct-row-sub' }, 'Service times and addresses at all four sites')),
  ic('right', 18, 2));

  const reach = [whatsapp && reachCard(whatsapp, 'chat', 'WhatsApp', CHURCH.whatsapp), phone && reachCard(phone, 'phone', 'Call', CHURCH.phone)].filter(Boolean);

  fill(root,
    h('header', { class: 'screen-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Contact us')),
    reach.length ? h('div', { class: `ct-reach-grid${reach.length === 1 ? ' one' : ''}` }, reach) : null,
    h('div', { class: 'card ct-rows' },
      rowLink(`mailto:${CHURCH.email}`, 'Email', CHURCH.email),
      rowLink(`mailto:${CHURCH.email}?subject=${encodeURIComponent('Prayer request')}`, 'Prayer request', 'Sent by email to the church team'),
      visitBtn),
    visit,
    h('a', { class: 'card ct-map', href: mapsHref(main.address), target: '_blank', rel: 'noopener' },
      h('span', { class: 'ct-map-art', 'aria-hidden': 'true' }, ic('pin', 28, 1.8)),
      h('span', { class: 'ct-find' }, h('span', { class: 'ct-find-label' }, 'Find us'), h('span', { class: 'ct-find-addr' }, main.address)),
      h('span', { class: 'sr' }, ' Opens in Maps')));
}

// The four sites, event types and ministries, as in the approved design (design/Events*.dc.html).
// The weekly gatherings are the times published on lifecentre.sg. They live here until they move to Firestore.

export const TYPES = { service: 'Services', kids: 'Kids', youth: 'Youth', cell: 'Cell groups', prayer: 'Prayer', special: 'Special events' };
export const TYPE_IDS = Object.keys(TYPES);

export const SITE_IDS = ['yishun', 'tuas', 'kranji', 'pasir'];
export const SITES = {
  yishun: {
    id: 'yishun', name: 'Yishun', venue: 'Life Centre @ Yishun', address: '3 Yishun Street 11, Singapore 768645', grad: ['#2F6BFF', '#6B4FA8'],
    weekly: {
      service: [
        { name: 'Tamil Service', when: 'Every Sunday', time: '8.00am & 7.00pm', person: 'Pas Grace Deborah', role: 'Senior Pastor' },
        { name: 'English Service', when: 'Every Sunday', time: '10.30am', person: 'Rev. Samuel Gift', role: 'Senior Overseer' },
        { name: 'Thai Service', when: 'Every Sunday', time: '1.00pm', person: 'Pas. Kittiya Darakam', role: 'Thai Pastor' },
        { name: 'Mandarin Service', when: 'Every Sunday', time: '4.00pm', person: 'Sis Amanda', role: 'Mandarin Ministry Leader' },
        { name: 'Malayalam Service', when: 'Every 3rd Saturday', time: '7.00pm', person: 'Pas. Rajesh Menon', role: 'Malayalam Service Pastor' },
      ],
      kids: [{ name: 'Sunday School', when: 'Every Sunday', time: '8.30am', person: 'Pas Aarathi Ramchand', role: 'Children & Youth Pastor' }],
      youth: [
        { name: 'Youth Connect (17 to 24)', when: 'Every Saturday', time: '3.00pm', person: 'Bro. Andrew & Sis. Sharon', role: 'Youth Leaders' },
        { name: 'Teens Connect (12 to 17)', when: 'Every Saturday', time: '3.00pm', person: 'Pas. Aarathi & Bro. Ryan', role: 'Youth Leaders' },
      ],
    },
  },
  tuas: {
    id: 'tuas', name: 'Tuas', venue: 'Life Centre @ Tuas', address: 'Tuas South Recreation Center, 12 Tuas South Street 13, Singapore 636937', grad: ['#0F766E', '#22B8A6'],
    weekly: { service: [{ name: 'Tamil & Telugu Service', when: 'Every Sunday', time: '7.00pm', person: 'Pastor Joel Daniel', role: 'Church Elder' }] },
  },
  kranji: {
    id: 'kranji', name: 'Kranji', venue: 'Life Centre @ Kranji', address: 'Kranji Recreation Center, 11 Kranji Cl, Singapore 737673', grad: ['#15803D', '#84CC16'],
    weekly: { service: [{ name: 'Tamil Service', when: 'Every Sunday', time: '8.00pm', person: 'Bro. Selvaraj', role: 'Ministry Leader (Kranji)' }] },
  },
  pasir: {
    id: 'pasir', name: 'Pasir Ris', venue: 'Life Centre @ Pasir Ris', address: 'Pentecost Methodist Church, 4 Pasir Ris Drive 6, Singapore 519420', grad: ['#C2410C', '#F59E0B'],
    weekly: { service: [{ name: 'Tamil / English Service', when: 'Every Sunday', time: '5.00pm', person: 'Rev P Kunam', role: 'Lead Pastor' }] },
  },
};

// Ministries people can follow on the Discover view. `type` links a ministry to the event type it runs.
export const MINISTRIES = [
  { id: 'youth', name: 'Teens & Youth', line: 'Saturday gatherings, ages 12 to 24', grad: ['#FF6A3D', '#E5326B'], type: 'youth' },
  { id: 'kids', name: 'Children’s Ministry', line: 'Sunday School and kids events', grad: ['#F5B700', '#38B26B'], type: 'kids' },
  { id: 'prayer', name: 'Prayer Ministry', line: 'Prayer nights and prayer chains', grad: ['#2A1B6B', '#7A3FD6'], type: 'prayer' },
  { id: 'cell', name: 'Cell Groups', line: 'Small groups across Singapore', grad: ['#14532D', '#4ADE80'], type: 'cell' },
];

// Cover colours offered when creating an event.
export const COVERS = [['#1B1740', '#3558C8'], ['#2A1B6B', '#7A3FD6'], ['#FF6A3D', '#E5326B'], ['#F5B700', '#38B26B'], ['#0F766E', '#22B8A6'], ['#1E3A8A', '#3B82F6']];

// How to reach the church. WhatsApp and phone are left empty until the numbers are known; empty ones are not shown.
export const CHURCH = { name: 'Life Centre', email: 'hello@lifecentre.sg', whatsapp: '', phone: '' };

export const siteName = (id, place) => SITES[id]?.name ?? (place || 'Elsewhere');
export const siteVenue = (id, place) => SITES[id]?.venue ?? (place || 'Venue to be confirmed');
export const siteAddress = (id) => SITES[id]?.address ?? '';

export function weeklyCount(site) {
  return Object.values(site.weekly).reduce((n, list) => n + list.length, 0);
}

// "Pas Grace Deborah" -> "GD"; "Children’s Ministry" -> "CS".
export function initials(name) {
  return String(name).replace(/[^A-Za-z& ]/g, ' ').split(/\s+/)
    .filter((w) => w && !/^(rev|pas|pastor|bro|sis|the|of|and|&)$/i.test(w))
    .slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'LC';
}

// The words printed on a cover, in at most two lines: "Youth Connect: Faith on Fire" -> "YOUTH\nCONNECT:".
export function coverWords(title) {
  const words = String(title || 'Your event').toUpperCase().split(/\s+/).filter(Boolean);
  let a = '';
  let b = '';
  for (const w of words) {
    if (!b && `${a} ${w}`.trim().length <= 12) a = `${a} ${w}`.trim();
    else if (`${b} ${w}`.trim().length <= 14) b = `${b} ${w}`.trim();
  }
  return b ? `${a}\n${b}` : a;
}

export const hexToRgba = (hex, alpha) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

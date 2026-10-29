import { startRouter } from './router.js';
import { enableDragScroll } from './util.js';
import { onSession, startSession, isOnStaffList } from './session.js';

const outlet = document.getElementById('main');
enableDragScroll(outlet, 'y');

const tabs = [...document.querySelectorAll('.tab')];
startRouter({
  outlet,
  tabs,
  // Order matters: "/events/new" must come before "/events/:id".
  routes: [
    { path: '/', name: 'home', title: 'Home', load: () => import('./views/home.js') },
    { path: '/events', name: 'events', title: 'Events', load: () => import('./views/events.js') },
    { path: '/events/new', name: 'event-create', tab: 'events', title: 'Create event', load: () => import('./views/event-create.js') },
    { path: '/events/location/:id', name: 'events', title: 'Location', load: () => import('./views/location.js') },
    { path: '/events/:id/edit', name: 'event-create', tab: 'events', title: 'Edit event', load: () => import('./views/event-create.js') },
    { path: '/events/:id', name: 'events', title: 'Event', load: () => import('./views/event.js') },
    { path: '/day', name: 'day', tab: 'home', title: 'Day plan', load: () => import('./views/day.js') },
    { path: '/day/:date', name: 'day', tab: 'home', title: 'Day plan', load: () => import('./views/day.js') },
    { path: '/notifications', name: 'notifications', tab: 'home', title: 'Notifications', load: () => import('./views/notifications.js') },
    { path: '/announcements', redirect: '/notifications' }, // church notices live in Notifications now
    { path: '/giving', name: 'giving', title: 'Giving', load: () => import('./views/giving.js') },
    { path: '/watch', name: 'watch', title: 'Watch', load: () => import('./views/watch.js') },
    { path: '/contact', name: 'contact', title: 'Contact us', load: () => import('./views/contact.js') },
    { path: '/booking', name: 'booking', title: 'Facilities Booking Request', load: () => import('./views/booking.js') },
    { path: '/staff', name: 'staff', title: 'Staff', load: () => import('./views/staff.js') },
    { path: '/account', name: 'account', tab: 'home', title: 'Account', load: () => import('./views/account.js') },
  ],
});

// The fifth tab: "Contact us" for visitors and members, "Facilities Booking" for admins, staff and leaders.
const fifth = document.getElementById('tab-fifth');
function showFifthTab(session) {
  const facilities = isOnStaffList(session);
  const label = facilities ? 'Facilities Booking' : 'Contact us';
  fifth.dataset.route = facilities ? 'booking' : 'contact';
  fifth.setAttribute('href', facilities ? '#/booking' : '#/contact');
  fifth.title = label;
  fifth.setAttribute('aria-label', label);
  // toggleAttribute, because SVG elements have no `hidden` property
  fifth.querySelector('.ic-contact').toggleAttribute('hidden', facilities);
  fifth.querySelector('.ic-facilities').toggleAttribute('hidden', !facilities);
  for (const tab of tabs) {
    if (tab.dataset.route === document.body.dataset.route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}
onSession(showFifthTab);
setTimeout(startSession, 0); // after the first screen is drawn

// The service worker keeps the app shell (never data) so the app opens offline and can be added to the home screen.
// Not registered against the local emulators, so tests and development always see the files as they are (add &sw to try it).
if ('serviceWorker' in navigator) {
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('emulator') && !params.has('sw');
  if (!local) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('No offline copy:', e.message)));
}

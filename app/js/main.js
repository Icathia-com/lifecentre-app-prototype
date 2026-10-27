import { startRouter } from './router.js';
import { enableDragScroll } from './util.js';
import { onSession, startSession, isOnStaffList } from './session.js';

const outlet = document.getElementById('main');
enableDragScroll(outlet, 'y');

// Screens that are not built yet share one "Coming soon" page.
const soon = (title) => () => import('./views/coming-soon.js').then((m) => ({ render: (root) => m.render(root, title) }));

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
    { path: '/notifications', name: 'notifications', tab: 'home', title: 'Notifications', load: () => import('./views/notifications.js') },
    { path: '/announcements', redirect: '/notifications' }, // church notices live in Notifications now
    { path: '/giving', name: 'giving', title: 'Giving', load: soon('Giving') },
    { path: '/watch', name: 'watch', title: 'Watch', load: soon('Watch') },
    { path: '/contact', name: 'contact', title: 'Contact us', load: soon('Contact us') },
    { path: '/booking', name: 'booking', title: 'Facilities Booking Request', load: soon('Facilities Booking Request') },
    { path: '/staff', name: 'staff', title: 'Staff', load: () => import('./views/staff.js') },
  ],
});

// The fifth tab: "Contact us" for visitors and members, "Facilities Booking" for admins, staff and leaders.
const fifth = document.getElementById('tab-fifth');
function showFifthTab(session) {
  const facilities = isOnStaffList(session);
  const label = facilities ? 'Facilities Booking' : 'Contact us';
  fifth.dataset.route = facilities ? 'booking' : 'contact';
  fifth.setAttribute('href', facilities ? '#/booking' : '#/contact');
  fifth.title = facilities ? label : `${label} (coming soon)`;
  fifth.setAttribute('aria-label', facilities ? label : `${label}, coming soon`);
  fifth.classList.toggle('tab-soon', !facilities);
  // toggleAttribute, because SVG elements have no `hidden` property
  fifth.querySelector('.ic-contact').toggleAttribute('hidden', facilities);
  fifth.querySelector('.ic-facilities').toggleAttribute('hidden', !facilities);
  fifth.querySelector('.soon').toggleAttribute('hidden', facilities);
  for (const tab of tabs) {
    if (tab.dataset.route === document.body.dataset.route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}
onSession(showFifthTab);
setTimeout(startSession, 0); // after the first screen is drawn

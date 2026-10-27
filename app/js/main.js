import { startRouter } from './router.js';
import { enableDragScroll } from './util.js';

const outlet = document.getElementById('main');
enableDragScroll(outlet, 'y');

startRouter({
  outlet,
  tabs: [...document.querySelectorAll('.tab')],
  routes: [
    { path: '/', name: 'home', title: 'Home', load: () => import('./views/home.js') },
    { path: '/announcements', name: 'announcements', title: 'Announcements', load: () => import('./views/announcements.js') },
    { path: '/staff', name: 'staff', title: 'Staff', load: () => import('./views/staff.js') },
  ],
});

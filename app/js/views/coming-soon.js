// A placeholder for screens that are not built yet (Giving, Watch, Contact, Facilities Booking Request).
import { h } from '../util.js';

export function render(root, title) {
  root.append(
    h('header', { class: 'screen-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, title)),
    h('section', { class: 'glass card', 'aria-label': 'Coming soon' },
      h('h2', { class: 'big' }, 'Coming soon')));
}

// A simple hash router: "#/announcements" loads views/announcements.js and calls its render(root).
// render() may return a function that is called when the user leaves the screen.
export function startRouter({ outlet, routes, tabs = [] }) {
  let cleanup = null;
  let ticket = 0;

  async function show() {
    const mine = ++ticket;
    const path = location.hash.slice(1).split('?')[0] || '/';
    const route = routes.find((r) => r.path === path) ?? routes[0];

    if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
    document.body.dataset.route = route.name;
    document.title = `${route.title} · Life Centre`;
    for (const tab of tabs) {
      if (tab.dataset.route === route.name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    outlet.replaceChildren();
    outlet.scrollTop = 0;

    const view = await route.load();
    if (mine !== ticket) return;
    const leave = await view.render(outlet);
    if (mine !== ticket) { if (typeof leave === 'function') leave(); return; }
    cleanup = typeof leave === 'function' ? leave : null;
    outlet.querySelector('h1')?.focus({ preventScroll: true });
  }

  addEventListener('hashchange', show);
  return show();
}

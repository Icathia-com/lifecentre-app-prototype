// A simple hash router: "#/events/youth" loads the view for "/events/:id" and calls its render(root, params).
// render() may return a function that is called when the user leaves the screen.
// A route can also be { path, redirect } to send old links somewhere else.
const compile = (path) => {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
  return { re, keys };
};

function match(routes, path) {
  for (const route of routes) {
    route.compiled ??= compile(route.path);
    const m = route.compiled.re.exec(path);
    if (m) return { route, params: Object.fromEntries(route.compiled.keys.map((key, i) => [key, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function startRouter({ outlet, routes, tabs = [] }) {
  let cleanup = null;
  let ticket = 0;

  async function show() {
    const mine = ++ticket;
    const path = location.hash.slice(1).split('?')[0] || '/';
    const found = match(routes, path) ?? { route: routes[0], params: {} };
    if (found.route.redirect) { location.replace(`#${found.route.redirect}`); return; }
    const { route, params } = found;

    if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
    document.body.dataset.route = route.name;
    document.title = `${route.title} · Life Centre`;
    for (const tab of tabs) {
      if (tab.dataset.route === (route.tab ?? route.name)) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    outlet.replaceChildren();
    outlet.scrollTop = 0;

    const view = await route.load();
    if (mine !== ticket) return;
    const leave = await view.render(outlet, params);
    if (mine !== ticket) { if (typeof leave === 'function') leave(); return; }
    cleanup = typeof leave === 'function' ? leave : null;
    outlet.querySelector('h1')?.focus({ preventScroll: true });
  }

  addEventListener('hashchange', show);
  return show();
}

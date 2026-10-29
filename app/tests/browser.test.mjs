// The real screens in a real browser (Edge or Chrome, headless) against the local emulators.
// Run with: npm run test:browser   (set BROWSER_PATH to use a different browser; SHOT_DIR to save screenshots)
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { serve } from '../../scripts/serve.mjs';
import { dateKey, addDays, dayStart } from '../js/util.js';

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const SHOTS = process.env.SHOT_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ADMIN = 'admin@lifecentre.sg';
const STAFF = 'staff@lifecentre.sg';
const LEADER = 'leader@lifecentre.sg';
const TODAY = dateKey();
const at = (days, hour, minute = 0) => Timestamp.fromMillis(dayStart(addDays(TODAY, days)) + (hour * 60 + minute) * 60000);

let env, server, browser, base;
before(async () => {
  assert.ok(executablePath, 'No Edge or Chrome found: set BROWSER_PATH');
  env = await initializeTestEnvironment({ projectId: 'lifecentre-app', firestore: { rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
  server = await serve(0);
  base = `http://localhost:${server.address().port}/app/?emulator`;
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run'] });
});
after(async () => {
  await browser?.close();
  server?.close();
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/lifecentre-app/accounts', { method: 'DELETE' });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const by = { updatedBy: STAFF };
    await setDoc(doc(db, 'staff', ADMIN), { role: 'admin', updatedBy: ADMIN });
    await setDoc(doc(db, 'staff', STAFF), { role: 'staff', updatedBy: ADMIN });
    await setDoc(doc(db, 'staff', LEADER), { role: 'leader', updatedBy: ADMIN });
    await setDoc(doc(db, 'verses', TODAY), { reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.', translation: 'KJV', ...by });
    await setDoc(doc(db, 'announcements', 'n-thanks'), { title: 'Thank you, volunteers', body: 'Thank you to everyone who served.', pinned: false, published: true, publishedAt: at(-1, 18), sample: true, ...by });
    await setDoc(doc(db, 'announcements', 'n-draft'), { title: 'Secret notice', body: '', pinned: false, published: false, publishedAt: at(0, 9), ...by });
    const ev = { published: true, ...by };
    await setDoc(doc(db, 'events', 'conf'), { ...ev, title: 'Empower Conference 2027', start: at(60, 9), end: at(60, 17), location: 'yishun', type: 'special', host: 'Life Centre', pinned: true, registerUrl: 'https://example.org/register', cover: { from: '#1B1740', to: '#3558C8', label: 'EMPOWER\n2027' }, description: 'A weekend for the whole church.' });
    await setDoc(doc(db, 'events', 'e1'), { ...ev, title: 'Cell group night', start: at(2, 19, 30), end: at(2, 21), location: 'yishun', type: 'cell', host: 'Discipleship Team', cover: { from: '#14532D', to: '#4ADE80', label: 'CELL\nGROUP' }, description: 'Bring a friend.' });
    await setDoc(doc(db, 'events', 'e2'), { ...ev, title: 'Sample lunch', start: at(4, 12, 30), location: 'other', place: 'Park', type: 'special', host: 'Life Centre', sample: true, going: 24 });
    await setDoc(doc(db, 'events', 'e3'), { ...ev, title: 'Secret draft event', start: at(2, 10), location: 'yishun', type: 'special', published: false });
    await setDoc(doc(db, 'events', 'e4'), { ...ev, title: 'Youth night', start: at(5, 19), location: 'tuas', type: 'youth', host: 'Teens & Youth', createdAt: Timestamp.fromMillis(Date.now() - 3600000) });
  });
});

// Each test gets its own browser profile, so sign-in state and saved content never leak between tests.
async function open(hash = '#/', { width = 390, height = 844, setup } = {}) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(new URL(base).origin, ['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width, height });
  if (setup) await setup(page);
  await page.goto(base + hash);
  await page.waitForSelector('#page-title');
  return { page, errors, context };
}

const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const shotEl = async (page, selector, name) => { if (!SHOTS) return; await (await page.$(selector)).screenshot({ path: `${SHOTS}/${name}.png` }); };
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
// innerText follows the page's CSS (a badge shown in capitals reads as capitals), so compare ignoring case.
const waitText = (page, needle, selector = 'body') => page.waitForFunction((n, s) => document.querySelector(s)?.innerText.toLowerCase().includes(n.toLowerCase()), { timeout: 15000 }, needle, selector);
const goto = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector('#page-title'); };
const pageTitle = (page) => page.$eval('#page-title', (e) => e.textContent);
const waitTitle = (page, title) => page.waitForFunction((t) => document.querySelector('#page-title')?.textContent === t, { timeout: 15000 }, title);
// What the fifth tab says and which icon is actually showing (a label can change while the wrong icon stays).
const fifthTab = (page) => page.$eval('#tab-fifth', (a) => {
  const shown = (sel) => getComputedStyle(a.querySelector(sel)).display !== 'none';
  return {
    label: a.getAttribute('aria-label'), href: a.getAttribute('href'), route: a.dataset.route,
    icon: shown('.ic-facilities') && !shown('.ic-contact') ? 'facilities' : shown('.ic-contact') && !shown('.ic-facilities') ? 'contact' : 'both or neither',
  };
});

async function checkAccessibility(page, label) {
  await page.addScriptTag({ path: AXE });
  const { violations } = await page.evaluate(() => axe.run(document));
  assert.deepEqual(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), [], `${label} has accessibility problems`);
}

async function signIn(page, email) {
  await page.evaluate(async (mail) => {
    const { getAuthTools } = await import('/app/js/firebase.js');
    const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
    const { auth } = await getAuthTools();
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `id-${mail}`, email: mail, email_verified: true })));
  }, email);
  await page.waitForFunction((m) => JSON.parse(localStorage.getItem('lc:v1:session') || 'null')?.email === m, { timeout: 15000 }, email);
}

// Signs in on a first page, then returns the page ready to use (the role is saved on the phone for the next screens).
async function openAsStaff(path = '/events', email = STAFF) {
  const opened = await open('#/staff');
  await waitText(opened.page, 'Sign in with Google');
  await signIn(opened.page, email);
  await goto(opened.page, path);
  return opened;
}

describe('Home', () => {
  it('shows the greeting, verse, "Coming up" banner (the pinned event) and church calendar', async () => {
    const { page, errors, context } = await open();
    await waitText(page, 'Psalm 23:1');
    assert.equal(await text(page, '#page-title'), 'Today');
    assert.match(await text(page, '.verse-card blockquote'), /The LORD is my shepherd/);
    assert.equal(await page.$('.verse-card .badge'), null); // not sample
    await page.waitForSelector('.banner');
    assert.match(await text(page, '.banner'), /Coming up.*Empower Conference 2027/s);
    assert.equal(await page.$eval('.banner a.pill', (a) => a.href), 'https://example.org/register');
    assert.equal(await page.$eval('.banner h2 a', (a) => a.getAttribute('href')), '#/events/conf');
    await page.waitForSelector('.tile.card');
    assert.ok((await page.$$('.days .col')).length >= 21, 'the days around today are drawn');
    assert.equal((await page.$$('.tile.card')).length, 3); // the draft and the far-off conference are not in the days drawn
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Secret/);
    await shot(page, 'home');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('opens Notifications from the bell', async () => {
    const { page, context } = await open();
    assert.equal(await page.$eval('a[aria-label="Notifications"]', (a) => a.getAttribute('href')), '#/notifications');
    await page.click('a[aria-label="Notifications"]');
    await waitTitle(page, 'Notifications');
    await context.close();
  });
  it('gives each calendar block a Done, Up next, Later or Missed state, with times on the left', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    assert.match(await text(page, '.month'), /^[A-Z][a-z]+/);
    const shown = () => page.$$eval('.rail-row', (els) => els.filter((e) => e.offsetHeight > 0).map((e) => e.textContent));
    await page.waitForFunction(() => [...document.querySelectorAll('.rail-row')].filter((e) => e.offsetHeight > 0).length === 3);
    assert.deepEqual(await shown(), ['7:00 AM', '7:15 AM', '7:30 AM']); // the daily verse, devotion and prayer
    assert.deepEqual(await page.$$eval('.tile.card', (els) => els.map((e) => e.className.replace('tile ', ''))), ['later card', 'later card', 'later card']); // events still to come
    assert.deepEqual(await page.$$eval('.col-head.today', (heads) => [...heads[0].parentElement.querySelectorAll('.tile.line')].map((e) => e.className.replace('tile ', ''))), ['next line', 'later line', 'later line']);
    assert.deepEqual(await page.$$eval('.col-head.today', (heads) => [...heads[0].parentElement.querySelectorAll('.tile.line .t')].map((e) => e.textContent)), ['Verse', 'Devotion', 'Prayer']);
    assert.ok(await page.$('.tile.missed'), 'yesterday\'s unticked daily items are Missed');
    assert.equal(await page.$eval('.col-head.today .ring', (r) => r.style.getPropertyValue('--c')), '#E59A00');
    assert.match(await text(page, '.col-head.today .sr'), /0 of 3 done/);
    await context.close();
  });
  it('only gives a time row room when something is on it in the days on screen', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft === 18100);
    await page.waitForFunction(() => [...document.querySelectorAll('.rail-row')].filter((e) => e.offsetHeight === 32).length === 3 && [...document.querySelectorAll('.rail-row')].every((e) => e.offsetHeight === 0 || e.offsetHeight === 32)); // yesterday, today, tomorrow: only the slim daily lines
    await shotEl(page, '.cal', 'home-calendar-today');
    await page.$eval('.days', (d) => { d.scrollLeft += 200; });
    await page.waitForFunction(() => [...document.querySelectorAll('.rail-row')].some((e) => e.offsetHeight === 64));
    await new Promise((r) => setTimeout(r, 600));
    await shotEl(page, '.cal', 'home-calendar-events');
    await context.close();
  });
  it('opens the event page when an event is chosen', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    await page.$$eval('.tile.card', (tiles) => tiles[0].click());
    await waitTitle(page, 'Cell group night');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'events');
    await context.close();
  });
  it('still shows the daily verse, devotion and prayer when no event is coming up', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { for (const id of ['e1', 'e2', 'e4']) await setDoc(doc(ctx.firestore(), 'events', id), { title: 'x', start: at(40, 9), location: 'yishun', type: 'special', published: true, updatedBy: STAFF }); });
    const { page, context } = await open();
    await page.waitForSelector('.tile.line');
    await waitText(page, 'Psalm 23:1');
    assert.equal((await page.$$('.tile.card')).length, 0);
    assert.ok((await page.$$('.tile.line')).length >= 21 * 3);
    await context.close();
  });
  it('has a profile menu with a small "Contact us" link', async () => {
    const { page, context } = await open();
    assert.equal(await page.$eval('#profile-menu', (m) => m.hidden), true);
    await page.click('.avatar');
    assert.match(await text(page, '#profile-menu a'), /^Contact us$/);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#profile-menu', (m) => m.hidden), true);
    await page.click('.avatar');
    await page.click('#profile-menu a');
    await waitTitle(page, 'Contact us');
    assert.match(page.url(), /#\/contact$/);
    await context.close();
  });
  it('lists Facilities Booking Request in the + menu', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card'); // let the calendar finish drawing first
    await page.waitForSelector('.banner');
    await page.$eval('.fab', (b) => b.scrollIntoView({ block: 'center' })); // it sits at the bottom of the calendar card
    await page.click('.fab');
    assert.deepEqual(await page.$$eval('#fab-menu > *', (els) => els.map((e) => e.textContent.trim())), ['Add a task', 'Facilities Booking Request']);
    assert.match(await text(page, '#fab-menu a'), /Facilities Booking Request/);
    assert.equal(await page.$eval('#fab-menu a', (a) => a.getAttribute('href')), '#/booking');
    await shotEl(page, '.cal', 'home-plus-menu');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open();
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.tile.card');
    await page.waitForSelector('.banner');
    await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running')); // colours are checked after the transitions end
    await checkAccessibility(page, 'Home');
    await context.close();
  });
});

describe('the bottom bar', () => {
  it('has five tabs: Home, Events, Giving, Watch and Contact us, and none is marked coming soon', async () => {
    const { page, context } = await open();
    assert.deepEqual(await page.$$eval('.tabbar .tab', (els) => els.map((e) => e.getAttribute('aria-label'))), ['Home', 'Events', 'Giving', 'Watch', 'Contact us']);
    assert.equal((await page.$$('.tab-soon, .tab .soon')).length, 0);
    for (const [route, title] of [['giving', 'Giving via PayNow'], ['watch', 'Watch'], ['contact', 'Contact us']]) {
      await page.click(`.tab[data-route="${route}"]`);
      await waitTitle(page, title);
      assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), route);
      assert.doesNotMatch(await page.$eval('#main', (m) => m.innerText), /coming soon/i);
    }
    await context.close();
  });
  it('keeps the Events tab lit on the location and event pages', async () => {
    const { page, context } = await open('#/events/location/tuas');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'events');
    await goto(page, '/events/e1');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'events');
    await context.close();
  });
  it('sends the old Announcements address to Notifications', async () => {
    const { page, context } = await open('#/announcements');
    await waitTitle(page, 'Notifications');
    assert.match(page.url(), /#\/notifications$/);
    await context.close();
  });
  it('shows "Contact us" as the fifth tab to visitors, and Facilities Booking to admins, staff and leaders', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    assert.deepEqual(await fifthTab(page), { label: 'Contact us', href: '#/contact', route: 'contact', icon: 'contact' });
    for (const email of [STAFF, LEADER, ADMIN]) {
      await signIn(page, email);
      await page.waitForFunction(() => document.querySelector('#tab-fifth').dataset.route === 'booking', { timeout: 15000 });
      assert.deepEqual(await fifthTab(page), { label: 'Facilities Booking', href: '#/booking', route: 'booking', icon: 'facilities' }, email);
      await page.click('button::-p-text(Sign out)');
      await page.waitForFunction(() => document.querySelector('#tab-fifth').dataset.route === 'contact', { timeout: 15000 });
    }
    await context.close();
  });
  it('keeps "Contact us" for someone signed in with Google who is not on the staff list', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await page.evaluate(async () => {
      const { getAuthTools } = await import('/app/js/firebase.js');
      const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
      const { auth } = await getAuthTools();
      await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'v', email: 'visitor@example.com', email_verified: true })));
    });
    await waitText(page, 'is not on the staff list');
    assert.equal((await fifthTab(page)).route, 'contact');
    await context.close();
  });
  it('remembers the role for the next visit, so the tab is right on the first paint', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, LEADER);
    await page.waitForFunction(() => document.querySelector('#tab-fifth').dataset.route === 'booking');
    await page.goto(base + '#/');
    await page.waitForSelector('#page-title');
    assert.equal((await fifthTab(page)).route, 'booking');
    await context.close();
  });
});

describe('Events: Upcoming', () => {
  it('shows the pinned conference, then events grouped by day in date order', async () => {
    const { page, errors, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    assert.equal(await pageTitle(page), 'Events');
    assert.match(await text(page, '.feature'), /PINNED.*Empower Conference 2027.*Life Centre @ Yishun.*Register/s);
    assert.equal(await page.$eval('.feature', (a) => a.getAttribute('href')), '#/events/conf');
    assert.deepEqual(await page.$$eval('.ev-row .ev-title', (els) => els.map((e) => e.textContent)), ['Cell group night', 'Sample lunch', 'Youth night']); // the pinned one is not repeated; the draft is hidden
    const heads = await page.$$eval('.day-head', (els) => els.map((e) => e.textContent));
    assert.equal(heads.length, 3);
    assert.match(heads[0], /^\d+ \w+ \/ \w+day$/);
    assert.match(await text(page, '.ev-row'), /Discipleship Team.*7:30 PM.*Yishun/s); // host, time, place
    assert.match(await text(page, '.sec-title small'), /Sample events/); // only because one shown event is sample
    await shot(page, 'events-upcoming');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('filters by location', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await page.click('.pill-btn');
    assert.deepEqual(await page.$$eval('.menu button', (els) => els.map((e) => e.textContent)), ['All locations', 'Yishun', 'Tuas', 'Kranji', 'Pasir Ris']);
    await page.click('.menu button::-p-text(Tuas)');
    assert.deepEqual(await page.$$eval('.ev-row .ev-title', (els) => els.map((e) => e.textContent)), ['Youth night']);
    await page.click('.pill-btn');
    await page.click('.menu button::-p-text(Kranji)');
    await waitText(page, 'Nothing coming up at Kranji.');
    await context.close();
  });
  it('searches by name, host, place and type', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await page.click('button[aria-label="Search events"]');
    await page.type('input[type=search]', 'discipleship');
    assert.deepEqual(await page.$$eval('.ev-row .ev-title', (els) => els.map((e) => e.textContent)), ['Cell group night']);
    await page.$eval('input[type=search]', (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('input[type=search]', 'zzz');
    await waitText(page, 'No events match your search.');
    await context.close();
  });
  it('shows "+ Event" to admins and staff only', async () => {
    const visitor = await open('#/events');
    await visitor.page.waitForSelector('.ev-row');
    assert.equal(await visitor.page.$eval('.fab-pill', (a) => a.hidden), true);
    await visitor.context.close();
    for (const [email, shown] of [[STAFF, true], [ADMIN, true], [LEADER, false]]) {
      const { page, context } = await openAsStaff('/events', email);
      await page.waitForSelector('.ev-row');
      assert.equal(await page.$eval('.fab-pill', (a) => a.hidden), !shown, email);
      if (shown) assert.equal(await page.$eval('.fab-pill', (a) => a.getAttribute('href')), '#/events/new');
      await context.close();
    }
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await checkAccessibility(page, 'Events (Upcoming)');
    await context.close();
  });
});

describe('Events: Discover', () => {
  it('shows this week, browse by location with counts, and ministries to follow', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await page.click('#tab-disc');
    await page.waitForSelector('.site-card');
    assert.equal(await page.$eval('#tab-disc', (b) => b.getAttribute('aria-selected')), 'true');
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event')); // wait for the events to arrive
    assert.match(await text(page, '.sec-head'), /Popular this week/); // one event has a "going" count
    assert.deepEqual(await page.$$eval('.pop-card .pop-title', (els) => els.map((e) => e.textContent)), ['Sample lunch', 'Cell group night', 'Youth night']); // most going first, then by date
    const cards = await page.$$eval('.site-card', (els) => els.map((e) => [e.getAttribute('href'), e.querySelector('.site-name').textContent, e.querySelector('.site-count').textContent, e.querySelector('.site-next').textContent]));
    assert.deepEqual(cards, [
      ['#/events/location/yishun', 'Yishun', '8 weekly gatherings · 1 event', 'Every Sunday, 8.00am & 7.00pm'], // the pinned conference is not counted
      ['#/events/location/tuas', 'Tuas', '1 weekly gathering · 1 event', 'Every Sunday, 7.00pm'],
      ['#/events/location/kranji', 'Kranji', '1 weekly gathering · 0 events', 'Every Sunday, 8.00pm'],
      ['#/events/location/pasir', 'Pasir Ris', '1 weekly gathering · 0 events', 'Every Sunday, 5.00pm'],
    ]);
    assert.deepEqual(await page.$$eval('.min-row b', (els) => els.map((e) => e.textContent)), ['Teens & Youth', 'Children’s Ministry', 'Prayer Ministry', 'Cell Groups']);
    await shot(page, 'events-discover');
    await context.close();
  });
  it('remembers the ministries you follow and the view you were on', async () => {
    const { page, context } = await open('#/events');
    await page.click('#tab-disc');
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event'));
    await page.click('button[aria-label="Follow Prayer Ministry"]');
    assert.equal(await page.$eval('button[aria-label="Following Prayer Ministry"]', (b) => b.textContent), 'Following');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event')); // still on Discover, once the events are in
    assert.equal(await page.$eval('#tab-disc', (b) => b.getAttribute('aria-selected')), 'true');
    assert.ok(await page.$('button[aria-label="Following Prayer Ministry"]'));
    await page.click('button[aria-label="Following Prayer Ministry"]');
    assert.ok(await page.$('button[aria-label="Follow Prayer Ministry"]'));
    await context.close();
  });
  it('goes back to Upcoming from "View all", and opens a location from its card', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await page.click('#tab-disc');
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event'));
    await page.click('.text-btn');
    await page.waitForSelector('.ev-row');
    await page.click('#tab-disc');
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event'));
    await page.click('.site-card[href="#/events/location/tuas"]');
    await waitTitle(page, 'Tuas');
    await context.close();
  });
  it('scrolls the week of events sideways with the mouse', async () => {
    const { page, context } = await open('#/events');
    await page.click('#tab-disc');
    await page.waitForFunction(() => document.querySelector('.site-count')?.textContent.includes('1 event'));
    const box = await (await page.$('.h-scroll')).boundingBox();
    await page.mouse.move(box.x + 300, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
    await page.mouse.up();
    assert.ok(await page.$eval('.h-scroll', (s) => s.scrollLeft) > 100, 'the cards did not scroll');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/events');
    await page.click('#tab-disc');
    await page.waitForSelector('.site-card');
    await checkAccessibility(page, 'Events (Discover)');
    await context.close();
  });
});

describe('Location page', () => {
  it('shows the address, Directions, weekly gatherings and events grouped by type', async () => {
    const { page, errors, context } = await open('#/events/location/yishun');
    await page.waitForSelector('.loc-row');
    assert.equal(await pageTitle(page), 'Yishun');
    assert.match(await text(page, '.loc-hero'), /LIFE CENTRE @.*Yishun.*3 Yishun Street 11, Singapore 768645.*Directions/s);
    assert.match(await page.$eval('.dir-btn', (a) => a.href), /google\.com\/maps\/search\/\?api=1&query=3%20Yishun%20Street%2011/);
    await page.waitForFunction(() => [...document.querySelectorAll('.loc-group h2')].some((h) => h.textContent === 'Cell groups'));
    assert.deepEqual(await page.$$eval('.loc-group', (els) => els.map((e) => [e.querySelector('h2').textContent, e.querySelector('.loc-group-head span').textContent])),
      [['Services', '5 items'], ['Kids', '1 item'], ['Youth', '2 items'], ['Cell groups', '1 item'], ['Special events', '1 item']]);
    assert.match(await text(page, '.loc-group'), /Tamil Service.*Pas Grace Deborah · Senior Pastor.*Every Sunday.*8\.00am & 7\.00pm/s);
    assert.match(await page.$eval('.loc-group[aria-label="Cell groups"]', (g) => g.innerText), /Cell group night.*, 7:30 PM/s);
    assert.match(await page.$eval('.loc-group[aria-label="Special events"]', (g) => g.innerText), /Empower Conference 2027/); // the pinned event is listed too
    assert.match(await text(page, '.foot'), /^Weekly times from lifecentre\.sg\./);
    await shot(page, 'location');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('filters by type, and switches location with the pills', async () => {
    const { page, context } = await open('#/events/location/yishun');
    await page.waitForFunction(() => [...document.querySelectorAll('.loc-group h2')].some((h) => h.textContent === 'Cell groups'));
    await page.click('button.chip::-p-text(Kids)');
    assert.deepEqual(await page.$$eval('.loc-group h2', (els) => els.map((e) => e.textContent)), ['Kids']);
    await page.click('button.chip::-p-text(All)');
    assert.equal((await page.$$('.loc-group')).length, 5);
    await page.click('a.chip[href="#/events/location/tuas"]');
    await waitTitle(page, 'Tuas');
    assert.match(await text(page, '.loc-hero'), /Tuas South Recreation Center/);
    await page.waitForFunction(() => [...document.querySelectorAll('.loc-row')].some((r) => r.textContent.includes('Youth night')));
    await context.close();
  });
  it('remembers the places you follow', async () => {
    const { page, context } = await open('#/events/location/kranji');
    assert.equal(await page.$eval('.follow-pill', (b) => b.getAttribute('aria-pressed')), 'false');
    await page.click('.follow-pill');
    assert.equal(await page.$eval('.follow-pill', (b) => b.getAttribute('aria-label')), 'Following Kranji');
    await page.reload();
    await page.waitForSelector('.follow-pill');
    assert.equal(await page.$eval('.follow-pill', (b) => b.getAttribute('aria-pressed')), 'true');
    await context.close();
  });
  it('falls back to Yishun for an unknown location', async () => {
    const { page, context } = await open('#/events/location/nowhere');
    assert.equal(await pageTitle(page), 'Yishun');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/events/location/yishun');
    await page.waitForFunction(() => [...document.querySelectorAll('.loc-group h2')].some((h) => h.textContent === 'Cell groups'));
    await checkAccessibility(page, 'Location');
    await context.close();
  });
});

describe('Event page', () => {
  it('shows the cover, host, when, type and place, with Contact and More', async () => {
    const { page, errors, context } = await open('#/events/e1');
    await waitTitle(page, 'Cell group night');
    assert.equal(await text(page, '.cover'), 'CELL\nGROUP');
    assert.match(await text(page, '.host-line'), /DT.*Discipleship Team/s);
    assert.match(await text(page, '.when-line'), /^\w+day, \d+ \w+ · 7:30 PM to 9:00 PM$/);
    assert.deepEqual(await page.$$eval('.pill-chip', (els) => els.map((e) => e.textContent)), ['Cell groups', 'Yishun']);
    assert.deepEqual(await page.$$eval('.acts > .act', (els) => els.map((e) => e.textContent)), ['Contact', 'More']); // no Register: it has no registration link
    assert.match(await text(page, '.loc-card'), /Life Centre @ Yishun.*3 Yishun Street 11, Singapore 768645.*Directions/s);
    assert.equal(await text(page, '.about'), 'Bring a friend.');
    assert.equal(await page.$('.going'), null); // nobody has registered, so no "who's going"
    await shot(page, 'event');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('shows Register when the event has a registration link, plus price, approval and capacity', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'events', 'e1'), { title: 'Paid night', start: at(2, 19), location: 'yishun', type: 'cell', published: true, updatedBy: STAFF, registerUrl: 'https://example.org/pay', price: 15, requireApproval: true, capacity: 50 }); });
    const { page, context } = await open('#/events/e1');
    await waitTitle(page, 'Paid night');
    assert.deepEqual(await page.$$eval('.acts > .act', (els) => els.map((e) => e.textContent)), ['Register', 'Contact', 'More']);
    assert.equal(await page.$eval('a.act.reg', (a) => a.href), 'https://example.org/pay');
    assert.deepEqual(await page.$$eval('.pill-chip', (els) => els.map((e) => e.textContent)), ['Cell groups', 'Yishun', 'S$15', 'Approval needed', 'Capacity 50']);
    await context.close();
  });
  it('shows who is going for a sample event only', async () => {
    const { page, context } = await open('#/events/e2');
    await waitTitle(page, 'Sample lunch');
    assert.match(await text(page, '.going'), /24 going/);
    assert.equal((await page.$$('.face')).length, 5);
    assert.ok((await page.$$eval('.pill-chip', (els) => els.map((e) => e.textContent))).includes('Sample'));
    assert.match(await text(page, '.loc-card'), /Park/); // a venue outside the four sites
    await context.close();
  });
  it('opens the Contact sheet with the church email, and shows only the numbers that are known', async () => {
    const { page, context } = await open('#/events/e1');
    await waitTitle(page, 'Cell group night');
    await page.click('.acts > button.act::-p-text(Contact)');
    await page.waitForSelector('[role=dialog]');
    assert.match(await text(page, '[role=dialog]'), /Contact the organiser.*Discipleship Team/s);
    assert.match(await page.$eval('[role=dialog] a[href^="mailto:"]', (a) => a.href), /^mailto:hello@lifecentre\.sg\?subject=About%3A%20Cell%20group%20night$/);
    assert.equal((await page.$$('[role=dialog] .sheet-row')).length, 1); // no WhatsApp or phone number configured yet
    await page.keyboard.press('Escape');
    assert.equal(await page.$('[role=dialog]'), null);
    await context.close();
  });
  it('has a More menu: add to calendar, share link, poster and QR code', async () => {
    const { page, context } = await open('#/events/e1');
    await waitTitle(page, 'Cell group night');
    await page.click('.act[aria-haspopup="menu"]');
    assert.deepEqual(await page.$$eval('.more-menu [role=menuitem]:not([hidden])', (els) => els.map((e) => e.textContent)), ['Add to calendar', 'Share event link', 'Share event poster', 'Event QR code']); // no Edit for visitors
    await page.click('.more-menu button::-p-text(Add to calendar)');
    await page.waitForSelector('[role=dialog]');
    assert.match(await page.$eval('[role=dialog] a[href^="https://calendar.google.com"]', (a) => a.href), /text=Cell\+group\+night.*location=Life\+Centre/);
    assert.match(await page.$eval('[role=dialog] a[download]', (a) => a.href), /^data:text\/calendar/);
    await page.click('.sheet-done');

    await page.evaluate(() => { // no share sheet in a test browser: take the copy-to-clipboard path, and note what was copied
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    });
    await page.click('.act[aria-haspopup="menu"]');
    await page.click('.more-menu button::-p-text(Share event link)');
    await waitText(page, 'Event link copied');
    assert.match(await page.evaluate(() => window.__copied), /^http:\/\/localhost:\d+\/app\/#\/events\/e1$/);

    await page.evaluate(() => { // a real download would stop a headless browser, so note the file name instead
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function stub() { if (this.hasAttribute('download')) { window.__downloaded = this.getAttribute('download'); return undefined; } return click.call(this); };
    });
    await page.click('.act[aria-haspopup="menu"]');
    await page.click('.more-menu button::-p-text(Share event poster)');
    await waitText(page, 'Poster saved');
    assert.equal(await page.evaluate(() => window.__downloaded), 'Cell group night.png');

    await page.click('.act[aria-haspopup="menu"]');
    await page.click('.more-menu button::-p-text(Event QR code)');
    await page.waitForSelector('svg[aria-label="QR code for this event"]', { timeout: 20000 });
    assert.ok(await page.$eval('svg[aria-label="QR code for this event"] path', (p) => p.getAttribute('d').length > 500), 'the QR code is empty');
    await context.close();
  });
  it('draws a poster image from the event', async () => {
    const { page, context } = await open('#/events/e1');
    await waitTitle(page, 'Cell group night');
    const [type, size] = await page.evaluate(async () => {
      const { makePoster } = await import('/app/js/poster.js');
      const blob = await makePoster({ title: 'Cell group night', start: Date.now() + 86400000, location: 'yishun', cover: { from: '#14532D', to: '#4ADE80', label: 'CELL\nGROUP' } });
      return [blob.type, blob.size];
    });
    assert.equal(type, 'image/png');
    assert.ok(size > 10000, `poster is only ${size} bytes`);
    await context.close();
  });
  it('offers Edit event to admins and staff only', async () => {
    const { page, context } = await openAsStaff('/events/e1');
    await waitTitle(page, 'Cell group night');
    await page.click('.act[aria-haspopup="menu"]');
    assert.deepEqual(await page.$$eval('.more-menu [role=menuitem]:not([hidden])', (els) => els.map((e) => e.textContent)), ['Edit event', 'Add to calendar', 'Share event link', 'Share event poster', 'Event QR code']);
    assert.equal(await page.$eval('.more-menu a[role=menuitem]', (a) => a.getAttribute('href')), '#/events/e1/edit');
    await context.close();
  });
  it('says so when the event is not there or is a draft', async () => {
    for (const id of ['nope', 'e3']) {
      const { page, context } = await open(`#/events/${id}`);
      await waitText(page, 'This event isn’t available');
      await context.close();
    }
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/events/conf');
    await waitTitle(page, 'Empower Conference 2027');
    await checkAccessibility(page, 'Event page');
    await context.close();
  });
});

describe('Create event', () => {
  it('is for staff only: visitors are asked to sign in, and leaders are told they cannot', async () => {
    const visitor = await open('#/events/new');
    await waitText(visitor.page, 'Staff only');
    assert.equal(await visitor.page.$eval('a.link', (a) => a.getAttribute('href')), '#/staff');
    assert.equal(await visitor.page.$('.cr-name'), null);
    await visitor.context.close();
    const { page, context } = await openAsStaff('/events/new', LEADER);
    await waitText(page, 'Leaders can’t create events');
    assert.equal(await page.$('.cr-name'), null);
    await context.close();
  });
  it('has no tab bar, and Create stays off until there is a name and a location', async () => {
    const { page, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    assert.equal(await page.$eval('.tabbar', (n) => getComputedStyle(n).display), 'none');
    assert.equal(await page.$eval('.cr-submit', (b) => b.disabled), true);
    assert.equal(await text(page, '.cover'), 'YOUR EVENT');
    await page.type('.cr-name', 'Youth night');
    assert.equal(await text(page, '.cover'), 'YOUTH NIGHT'); // the cover follows the name
    assert.equal(await page.$eval('.cr-submit', (b) => b.disabled), true); // no location yet
    await page.click('.cr-btn::-p-text(Choose location)');
    assert.deepEqual(await page.$$eval('.cr-chips .chip', (els) => els.map((e) => e.textContent)), ['Yishun', 'Tuas', 'Kranji', 'Pasir Ris', 'Other']);
    await page.click('.cr-chips .chip::-p-text(Tuas)');
    assert.equal(await page.$eval('.cr-submit', (b) => b.disabled), false);
    await page.$eval('input[aria-label="End time"]', (el) => { el.value = '09:00'; el.dispatchEvent(new Event('change', { bubbles: true })); }); // before the 19:30 start
    await page.waitForFunction(() => document.querySelector('.cr-submit').disabled);
    await shot(page, 'create');
    await context.close();
  });
  it('creates an event that then appears in Events, on its location page and as an event page', async () => {
    const { page, errors, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    await page.type('.cr-name', 'Worship night');
    await page.click('.cr-btn::-p-text(Choose location)');
    await page.click('.cr-chips .chip::-p-text(Pasir Ris)');
    await page.select('select[aria-label=Type]', 'prayer');
    await page.click('.cr-btn::-p-text(Add description)');
    await page.type('textarea[aria-label=Description]', 'An evening of worship.');
    await page.click('.cr-btn::-p-text(Price)'); // switches to paid
    await page.type('input[aria-label="Amount in Singapore dollars"]', '10');
    await page.$eval('input[aria-label="Registration link"]', (el) => { el.value = 'https://example.org/worship'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('button[aria-label="Require approval"]');
    await page.select('select[aria-label=Capacity]', '100');
    await page.click('.cr-submit');
    await waitText(page, 'Everyone can see it in Events. Followers are notified.');
    assert.equal(await pageTitle(page), 'Event created');
    await page.click('a.btn::-p-text(View event)');
    await waitTitle(page, 'Worship night');
    assert.deepEqual(await page.$$eval('.pill-chip', (els) => els.map((e) => e.textContent)), ['Prayer', 'Pasir Ris', 'S$10', 'Approval needed', 'Capacity 100']);
    assert.match(await text(page, '.host-line'), /PM.*Prayer Ministry/s); // the host follows the type
    assert.equal(await page.$eval('a.act.reg', (a) => a.href), 'https://example.org/worship');
    assert.equal(await text(page, '.about'), 'An evening of worship.');
    await goto(page, '/events');
    await waitText(page, 'Worship night', '#events-panel');
    await goto(page, '/events/location/pasir');
    await page.waitForFunction(() => [...document.querySelectorAll('.loc-group h2')].some((h) => h.textContent === 'Prayer'));
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('saves a draft that only staff can see', async () => {
    const { page, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    await page.type('.cr-name', 'Planning night');
    await page.click('.cr-btn::-p-text(Choose location)');
    await page.click('.cr-chips .chip::-p-text(Yishun)');
    await page.select('select[aria-label=Visibility]', 'draft');
    await page.click('.cr-submit');
    await waitText(page, 'Saved as a draft. Only staff can see it.');
    const viewer = await open('#/events');
    await viewer.page.waitForSelector('.ev-row');
    assert.doesNotMatch(await viewer.page.evaluate(() => document.body.innerText), /Planning night/);
    await viewer.context.close();
    await context.close();
  });
  it('keeps a draft on the phone and offers to restore it', async () => {
    const { page, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    await page.type('.cr-name', 'Half written');
    await page.reload();
    await page.waitForSelector('.cr-name');
    assert.equal(await page.$eval('.cr-name', (i) => i.value), '');
    await page.click('.cr-draft button::-p-text(Restore draft?)');
    assert.equal(await page.$eval('.cr-name', (i) => i.value), 'Half written');
    await page.reload(); // restored but not saved: the draft is still there, and can be dismissed
    await page.waitForSelector('.cr-draft');
    await page.click('button[aria-label="Dismiss draft"]');
    assert.equal(await page.$('.cr-draft'), null);
    await context.close();
  });
  it('uses a photo as the cover, shrunk to fit inside the event', async () => {
    const { page, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    await page.type('.cr-name', 'Photo night');
    await page.click('.cr-btn::-p-text(Choose location)');
    await page.click('.cr-chips .chip::-p-text(Yishun)');
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200;
      const g = c.getContext('2d');
      for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`; g.fillRect((i * 53) % 1600, (i * 29) % 1200, 120, 90); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'big.jpg', { type: 'image/jpeg' }));
      const input = document.querySelector('input[type=file]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.cover.photo');
    await page.click('.cr-submit');
    await waitText(page, 'Everyone can see it in Events.');
    const photo = await page.evaluate(async () => {
      const { data } = await import('/app/js/firebase.js');
      const link = document.querySelector('a.btn[href^="#/events/"]').getAttribute('href').split('/').pop();
      return (await data.getEvent(link)).value.cover.photo;
    });
    assert.match(photo, /^data:image\/jpeg;base64,/);
    assert.ok(photo.length <= 120000, `photo is ${photo.length} characters`);
    await context.close();
  });
  it('edits an event from its page, and can delete it', async () => {
    const { page, context } = await openAsStaff('/events/e1');
    await waitTitle(page, 'Cell group night');
    await page.click('.act[aria-haspopup="menu"]');
    await page.click('.more-menu a::-p-text(Edit event)');
    await page.waitForSelector('.cr-name');
    assert.equal(await pageTitle(page), 'Edit event');
    assert.equal(await page.$eval('.cr-name', (i) => i.value), 'Cell group night');
    assert.equal(await page.$eval('select[aria-label=Type]', (s) => s.value), 'cell');
    assert.equal(await page.$('.cr-draft'), null);
    await page.$eval('.cr-name', (i) => { i.value = ''; });
    await page.type('.cr-name', 'Cell group evening');
    await page.click('.cr-submit');
    await waitText(page, 'Everyone can see it in Events.');
    assert.equal(await pageTitle(page), 'Event updated');
    await page.click('a.btn::-p-text(View event)');
    await waitTitle(page, 'Cell group evening');
    await page.click('.act[aria-haspopup="menu"]');
    await page.click('.more-menu a::-p-text(Edit event)');
    await page.waitForSelector('button.danger');
    await page.click('button.danger');
    await waitTitle(page, 'Events');
    await page.waitForSelector('.ev-row');
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Cell group evening/);
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await openAsStaff('/events/new');
    await page.waitForSelector('.cr-name');
    await page.click('.cr-btn::-p-text(Choose location)');
    await page.click('.cr-btn::-p-text(Add description)');
    await checkAccessibility(page, 'Create event');
    await context.close();
  });
});

describe('Notifications', () => {
  it('lists church notices from the database, newest first, with unread dots and a Mark all read', async () => {
    const { page, errors, context } = await open('#/notifications');
    await page.waitForSelector('.nf-row');
    assert.equal(await pageTitle(page), 'Notifications');
    assert.equal(await page.$eval('.tabbar', (n) => getComputedStyle(n).display), 'none');
    assert.deepEqual(await page.$$eval('.nf-row b', (els) => els.map((e) => e.textContent)), ['Thank you, volunteers']); // the draft notice is not public
    assert.match(await text(page, '.nf-row'), /Thank you to everyone who served\. From Life Centre\./);
    assert.deepEqual(await page.$$eval('.nf-group h2', (els) => els.map((e) => e.textContent)), ['This week']);
    assert.equal(await page.$eval('.unread', (d) => d.getAttribute('aria-label')), 'Unread');
    await shot(page, 'notifications');
    await page.click('.mark-all');
    assert.equal(await page.$eval('.unread', (d) => d.getAttribute('aria-label')), 'Read');
    assert.equal(await page.$eval('.mark-all', (b) => b.hidden), true);
    await page.reload();
    await page.waitForSelector('.nf-row');
    assert.equal(await page.$eval('.unread', (d) => d.getAttribute('aria-label')), 'Read'); // remembered
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('adds new events at places and ministries you follow', async () => {
    const { page, context } = await open('#/events');
    await page.waitForSelector('.ev-row');
    await page.click('#tab-disc');
    await page.click('button[aria-label="Follow Teens & Youth"]');
    await goto(page, '/notifications');
    await waitText(page, 'New at Tuas: Youth night');
    assert.match(await text(page, '.nf-row'), /You follow Teens & Youth\./);
    assert.equal(await page.$eval('a.nf-row', (a) => a.getAttribute('href')), '#/events/e4');
    await goto(page, '/events');
    await page.click('#tab-disc');
    await page.click('button[aria-label="Following Teens & Youth"]');
    await goto(page, '/notifications');
    await page.waitForSelector('.nf-row');
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /New at Tuas/);
    await context.close();
  });
  it('has on/off settings that are remembered, and hide what is switched off', async () => {
    const { page, context } = await open('#/notifications');
    await page.waitForSelector('.nf-row');
    await page.click('#tab-set');
    assert.deepEqual(await page.$$eval('.nf-group h2', (els) => els.map((e) => e.textContent)), ['EVENTS YOU’RE GOING TO', 'PLACES AND MINISTRIES YOU FOLLOW', 'FROM THE CHURCH']); // no Staff section for visitors
    assert.deepEqual(await page.$$eval('.cr-switch', (els) => els.map((e) => [e.getAttribute('aria-label'), e.getAttribute('aria-checked')])), [
      ['Reminders', 'true'], ['Changes and cancellations', 'true'], ['New events', 'true'], ['Church notices', 'true'], ['Stories and devotions', 'true'], ['Verse of the day', 'false'],
    ]);
    await page.click('button[aria-label="Church notices"]');
    await page.reload();
    await page.waitForSelector('#tab-set');
    await page.click('#tab-set');
    assert.equal(await page.$eval('button[aria-label="Church notices"]', (b) => b.getAttribute('aria-checked')), 'false');
    await page.click('#tab-act');
    await waitText(page, 'Nothing new.'); // notices are switched off
    await context.close();
  });
  it('shows the Staff section of settings to admins, staff and leaders only', async () => {
    const { page, context } = await openAsStaff('/notifications', LEADER);
    await page.click('#tab-set');
    await page.waitForFunction(() => [...document.querySelectorAll('.nf-group h2')].some((h) => h.textContent === 'STAFF'));
    assert.ok(await page.$('button[aria-label="Booking requests"]'));
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/notifications');
    await page.waitForSelector('.nf-row');
    await checkAccessibility(page, 'Notifications (Activity)');
    await page.click('#tab-set');
    await checkAccessibility(page, 'Notifications (Settings)');
    await context.close();
  });
});

describe('when the database cannot be reached', () => {
  it('shows what was saved on the phone', async () => {
    // Visit the screens online first, so their code and content are loaded and saved.
    const { page, context } = await open('#/');
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.tile.card');
    await page.click('.tab[data-route="events"]');
    await page.waitForSelector('.ev-row');
    await page.click('.tab[data-route="home"]');
    await page.waitForSelector('.tile.card');
    await page.setOfflineMode(true);
    await page.click('.tab[data-route="events"]');
    await page.waitForSelector('.ev-row', { timeout: 20000 });
    await waitText(page, 'saved on this phone');
    assert.deepEqual(await page.$$eval('.ev-row .ev-title', (els) => els.map((e) => e.textContent)), ['Cell group night', 'Sample lunch', 'Youth night']);
    await page.click('.tab[data-route="home"]');
    await page.waitForSelector('.verse-card blockquote', { timeout: 20000 });
    await page.waitForSelector('.tile.card', { timeout: 20000 });
    await waitText(page, 'saved on this phone');
    assert.match(await text(page, '.verse-card blockquote'), /The LORD is my shepherd/);
    assert.equal((await page.$$('.tile.card')).length, 3);
    await context.close();
  });
  it('falls back to labelled sample content on a first visit', async () => {
    const { page, context } = await open('#/events', {
      setup: async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (new URL(r.url()).port === '8080' ? r.abort() : r.continue())); },
    });
    await waitText(page, 'sample content', '[role=status]');
    await page.waitForSelector('.ev-row', { timeout: 15000 });
    assert.match(await text(page, '.sec-title small'), /Sample events/);
    assert.match(await text(page, '.feature'), /Empower Conference 2027.*SAMPLE/si);
    await shot(page, 'events-offline');
    await goto(page, '/events/youth');
    await waitTitle(page, 'Youth Connect: Faith on Fire');
    assert.ok((await page.$$eval('.pill-chip', (els) => els.map((e) => e.textContent))).includes('Sample'));
    await context.close();
  });
});

describe('mouse drag scrolling', () => {
  it('scrolls the screen and the calendar days, and does not click what was dragged', async () => {
    const { page, context } = await open('#/', { width: 390, height: 560 });
    await page.waitForSelector('.tile.card');
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.banner'); // it pushes the calendar down when it arrives, so wait before measuring
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft === 18100);
    const drag = async (from, to) => {
      await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
    };
    assert.equal(await page.$eval('#main', (m) => m.scrollTop), 0);
    await drag([8, 500], [8, 200]); // from the empty gutter beside the cards
    assert.ok(await page.$eval('#main', (m) => m.scrollTop) > 100, 'screen did not scroll');

    await page.evaluate(() => { const tomorrow = document.querySelector('.col-head.today').parentElement.nextElementSibling.querySelector('.col-head'); tomorrow.id = 'tomorrow-head'; tomorrow.scrollIntoView({ block: 'center', inline: 'nearest' }); }); // clear of the tab bar
    await new Promise((r) => setTimeout(r, 300));
    const head = await (await page.$('#tomorrow-head')).boundingBox();
    assert.ok(head.y > 80 && head.y < 400, `calendar header is not clear of the tab bar (y=${head.y})`);
    const firstColumn = () => page.$eval('.days', (d) => Math.round(d.scrollLeft / 100));
    const start = await firstColumn();
    // Drag left by about two columns, starting on a day header. The click that ends a drag must not open that day.
    await drag([head.x + 80, head.y + 20], [head.x - 100, head.y + 20]);
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(await firstColumn() >= start + 2, `days did not scroll (first column ${await firstColumn()})`);
    assert.ok(await page.$eval('.days', (d) => d.scrollLeft % 100 === 0), 'the days settle on a whole day');
    assert.equal(await page.evaluate(() => location.hash), '#/');
    await context.close();
  });
});

// A stand-in for the church's booking system: it answers the app's calls the way the real one does, and records them.
function fakeBooking({ blocks = [], failure = null } = {}) {
  const TOKEN = 'a'.repeat(64);
  const state = { calls: [], bookings: [], blocks, failure };
  const reply = (body) => {
    const { action, token } = body;
    if (state.failure?.[action]) return state.failure[action];
    if (action === 'requestCode') return { ok: true, message: 'If this email is on our member list, a 6-digit code is on its way. It expires in 10 minutes.' };
    if (action === 'verifyCode') {
      return body.code === '123456'
        ? { ok: true, token: TOKEN, user: { name: 'Test Member', email: body.email } }
        : { ok: false, code: 'error', error: 'That code is not right. Check the email and try again.' };
    }
    if (token !== TOKEN) return { ok: false, code: 'signin', error: 'Please sign in again.' };
    if (action === 'config') return { ok: true, rooms: ['Whole Church', 'Main Sanctuary', 'Empower Room', 'Foyer', 'Dining Area', 'Cry Room', 'Carpark'], today: TODAY, maxDate: addDays(TODAY, 365), dayStart: '07:00', dayEnd: '23:00' };
    if (action === 'availability') return { ok: true, facility: body.facility, date: body.date, blocks: state.blocks };
    if (action === 'myBookings') return { ok: true, upcoming: state.bookings, past: [] };
    if (action === 'signOut') return { ok: true };
    if (action === 'book') {
      const entry = { id: 'LCC-E-ABC234', status: 'Approved', facility: body.facility, date: body.date, start: body.start, end: body.end, org: body.org, purpose: body.purpose, canCancel: false };
      state.bookings.push(entry);
      return { ok: true, bookingId: entry.id, status: 'Approved', facility: body.facility, date: body.date, start: body.start, end: body.end };
    }
    return { ok: false, code: 'input', error: 'Unknown action.' };
  };
  state.install = async (page, { signedIn = false, token = TOKEN } = {}) => {
    if (signedIn) await page.evaluateOnNewDocument((t) => localStorage.setItem('lc:v1:booking-session', JSON.stringify({ token: t, name: 'Test Member', email: 'member@example.org' })), token);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (!req.url().startsWith('https://script.google.com/')) return req.continue();
      const body = JSON.parse(req.postData() || '{}');
      state.calls.push(body);
      req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(body)) });
    });
  };
  return state;
}
const setField = (page, name, value) => page.$eval(`[name="${name}"]`, (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', { bubbles: true }));
}, value);

describe('Facilities booking', () => {
  it('asks a visitor to sign in with an emailed code, then shows the code step, and passes the accessibility check', async () => {
    const fake = fakeBooking();
    const { page, errors, context } = await open('#/booking', { setup: (p) => fake.install(p) });
    assert.equal(await pageTitle(page), 'Facilities Booking Request');
    await waitText(page, 'Sign in to book a room', '#main');
    assert.match(await text(page, '#main'), /We’ll email you a 6‑digit code\. No password needed\./);
    assert.match(await text(page, '#main'), /Not a member yet\?\s*Contact us/);
    await shot(page, 'booking-signed-out');
    await checkAccessibility(page, 'Booking sign-in');
    await page.type('#bk-email', 'not an email');
    await page.click('.cr-submit');
    await waitText(page, 'Enter a valid email address.', '#main');
    assert.deepEqual(fake.calls, []);
    await page.$eval('#bk-email', (el) => { el.value = ''; });
    await page.type('#bk-email', 'member@example.org');
    await page.click('.cr-submit');
    await page.waitForSelector('#bk-code');
    assert.deepEqual(fake.calls.map((c) => [c.action, c.email, c.token]), [['requestCode', 'member@example.org', undefined]]);
    assert.equal(await page.$eval('#bk-email', (el) => el.readOnly), true);
    await checkAccessibility(page, 'Booking code step');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('signs in with the right code, keeps the session, and signs out', async () => {
    const fake = fakeBooking();
    const { page, context } = await open('#/booking', { setup: (p) => fake.install(p) });
    await page.type('#bk-email', 'member@example.org');
    await page.click('.cr-submit');
    await page.waitForSelector('#bk-code');
    await page.type('#bk-code', '000000');
    await page.click('.cr-submit');
    await waitText(page, 'That code is not right', '#main');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    await page.$eval('#bk-code', (el) => { el.value = ''; });
    await page.type('#bk-code', '123456');
    await page.click('.cr-submit');
    await waitText(page, 'Choose a room', '#main');
    assert.equal((await page.$$('.bk-room')).length, 7);
    assert.match(await text(page, '#main'), /No upcoming bookings\./);
    assert.match(await text(page, '#main'), /Signed in as member@example\.org/);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session'))).token.length, 64);
    await shot(page, 'booking-home');
    await checkAccessibility(page, 'Booking home');
    await page.reload();
    await waitText(page, 'Choose a room', '#main'); // still signed in
    await page.$eval('.bk-signed .btn', (b) => b.scrollIntoView({ block: 'center' })); // it sits at the bottom of the page
    await page.click('.bk-signed .btn');
    await waitText(page, 'Sign in to book a room', '#main');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    assert.ok(fake.calls.some((c) => c.action === 'signOut' && c.token.length === 64));
    await context.close();
  });

  it('books a room: shows what is already booked, blocks a clash, sends only the form fields, and lists the booking', async () => {
    const fake = fakeBooking({ blocks: [{ start: '14:00', end: '16:00', kind: 'booked', wholeChurch: false }, { start: '18:00', end: '19:00', kind: 'pending', wholeChurch: false }] });
    const { page, errors, context } = await open('#/booking', { setup: (p) => fake.install(p, { signedIn: true }) });
    await waitText(page, 'Choose a room', '#main');
    await page.click('.bk-room:nth-child(3)'); // Empower Room
    await page.click('.cr-submit');
    await page.waitForSelector('[name="org"]');
    assert.equal(await pageTitle(page), 'New booking');
    assert.equal(await page.$eval('[name="room"]', (el) => el.value), 'Empower Room');
    await page.waitForSelector('.bk-slot');
    const slotState = () => page.$$eval('.bk-slot', (els) => els.map((el) => ({ t: el.dataset.slot, booked: el.disabled, on: el.getAttribute('aria-pressed') === 'true', label: el.querySelector('small')?.textContent ?? '' })));
    let slots = await slotState();
    assert.equal(slots.length, 16); // 07:00 to 22:00, one-hour slots
    assert.deepEqual(slots.filter((s) => s.booked).map((s) => [s.t, s.label]), [['14:00', 'Booked'], ['15:00', 'Booked']]); // only the word Booked, no details
    assert.equal(slots.find((s) => s.t === '18:00').label, 'Requested');
    assert.deepEqual(slots.filter((s) => s.on).map((s) => s.t), ['09:00']); // the default hour
    await page.click('[data-slot="10:00"]'); // adjoining: 09:00-11:00
    await page.click('[data-slot="11:00"]'); // adjoining: 09:00-12:00
    assert.deepEqual(await page.$$eval('[name="start"],[name="end"]', (els) => els.map((el) => el.value)), ['09:00', '12:00']);
    await page.click('[data-slot="17:00"]'); // not adjoining: starts again
    assert.deepEqual(await page.$$eval('[name="start"],[name="end"]', (els) => els.map((el) => el.value)), ['17:00', '18:00']);
    assert.equal(await page.$eval('.bk-slot[data-slot="14:00"]', (el) => el.disabled), true); // booked hours cannot be tapped
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), true);
    await setField(page, 'org', 'TEST, please ignore');
    await setField(page, 'purpose', 'TEST, please ignore');
    await setField(page, 'attendance', '12');
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), false);
    await page.select('[name="start"]', '15:00');
    await page.select('[name="end"]', '17:00');
    await waitText(page, 'That time is already booked for this room.', '#main');
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), true);
    await shot(page, 'booking-form-clash');
    await page.click('[data-slot="16:00"]');
    assert.deepEqual(await page.$$eval('[name="start"],[name="end"]', (els) => els.map((el) => el.value)), ['16:00', '17:00']);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.slot), '16:00'); // focus stays on the tapped hour
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), false);
    await shot(page, 'booking-form-slots');
    await checkAccessibility(page, 'Booking form');
    await page.click('#bk-submit');
    await waitText(page, 'Reference LCC-E-ABC234', '#main');
    assert.equal(await pageTitle(page), 'Booked');
    const sent = fake.calls.find((c) => c.action === 'book');
    assert.deepEqual(Object.keys(sent).sort(), ['action', 'attendance', 'date', 'end', 'facility', 'org', 'purpose', 'setupNeeds', 'start', 'token']);
    assert.deepEqual([sent.facility, sent.start, sent.end, sent.org, sent.attendance], ['Empower Room', '16:00', '17:00', 'TEST, please ignore', '12']);
    await shot(page, 'booking-done');
    await checkAccessibility(page, 'Booking confirmation');
    await page.click('.card.done .btn.primary');
    await waitText(page, 'TEST, please ignore', '#main');
    assert.match(await text(page, '.bk-item'), /Empower Room/);
    assert.match(await text(page, '.bk-item'), /16:00–17:00/);
    assert.match(await text(page, '.bk-status'), /Approved/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('goes back to sign-in when the session has ended, and shows a message when the booking system is unwell', async () => {
    const fake = fakeBooking();
    const { page, context } = await open('#/booking', { setup: (p) => fake.install(p, { signedIn: true, token: 'b'.repeat(64) }) });
    await waitText(page, 'Sign in to book a room', '#main');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    await context.close();

    const down = fakeBooking({ failure: { config: { ok: false, code: 'error', error: 'The booking system is busy. Try again in a moment.' } } });
    const second = await open('#/booking', { setup: (p) => down.install(p, { signedIn: true }) });
    await waitText(second.page, 'The booking system is busy. Try again in a moment.', '#main');
    assert.equal((await second.page.$$('#main .btn')).length, 1); // Try again
    await second.context.close();
  });

  it('is reached from the Home + menu, and from the fifth tab for staff', async () => {
    const fake = fakeBooking();
    const { page, context } = await open('#/', { setup: (p) => fake.install(p) });
    assert.equal(await page.$eval('#fab-menu a', (a) => a.getAttribute('href')), '#/booking');
    await context.close();
    const staff = await openAsStaff('/booking');
    await waitText(staff.page, 'Sign in to book a room', '#main');
    assert.equal((await fifthTab(staff.page)).label, 'Facilities Booking');
    await staff.context.close();
  });
});

describe('Home calendar: days, months and tasks', () => {
  it('draws 100px day columns, one day at a time, and jumps by month and back to today', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft === 18100);
    assert.equal(await page.$eval('.col', (c) => c.getBoundingClientRect().width), 100);
    assert.equal(await page.$eval('.today-badge', (b) => b.classList.contains('on')), true);
    await page.$eval('.days', (d) => { d.scrollLeft += 330; }); // part way between two days
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft % 100 === 0, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.today-badge:not(.on)'));
    const before = await text(page, '.month');
    await page.waitForSelector('.banner');
    await page.$eval('.month-btn', (b) => b.scrollIntoView({ block: 'center' }));
    await page.click('.month-btn');
    assert.equal(await page.$eval('.month-btn', (b) => b.getAttribute('aria-expanded')), 'true');
    assert.equal((await page.$$('#months .month-pick')).length, 19); // six months back, this month, a year ahead
    await shotEl(page, '.cal', 'home-months');
    await page.$$eval('#months .month-pick', (els) => els[els.length - 1].click());
    await page.waitForFunction((was) => document.querySelector('.month').textContent !== was, { timeout: 5000 }, before);
    assert.equal(await page.$eval('#months', (m) => m.hidden), true);
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft > 18100 + 300 * 100 / 3);
    await page.$eval('.today-badge', (b) => b.click());
    await page.waitForFunction(() => document.querySelector('.days').scrollLeft === 18100, { timeout: 5000 });
    assert.equal(await page.$eval('.today-badge', (b) => b.classList.contains('on')), true);
    await context.close();
  });
  it('opens the Day plan when a day, or one of its daily items, is tapped', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    await page.$eval('.col-head.today', (a) => a.click());
    await page.waitForSelector('.dp-card');
    assert.equal(await page.evaluate(() => location.hash), `#/day/${TODAY}`);
    await page.goBack();
    await page.waitForSelector('.tile.card');
    await page.$eval('.col-head.today', (a) => a.parentElement.querySelector('.tile.line').click());
    await page.waitForSelector('.dp-card');
    assert.equal(await page.evaluate(() => location.hash), `#/day/${TODAY}`);
    await context.close();
  });
  it('stacks slim blocks when two or three things share a time, and shows "+N more" for four or more', async () => {
    const day = addDays(TODAY, 1);
    const task = (id, title, repeat = 'none') => ({ id, title, date: day, min: 420, repeat, notes: '', done: {} }); // all at 7:00 AM, with the daily verse
    const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument((list) => { if (!localStorage.getItem('lc.tasks')) localStorage.setItem('lc.tasks', JSON.stringify(list)); }, [task('a', 'Task A'), task('b', 'Task B')]) });
    await page.waitForSelector('.tile.card');
    const col = () => page.$$eval('.col-head', (heads, key) => { const c = heads.find((a) => a.getAttribute('href') === '#/day/' + key).parentElement; return { stack: c.querySelectorAll('.tile.stack').length, more: [...c.querySelectorAll('.tile.more')].map((e) => e.textContent) }; }, day);
    assert.deepEqual(await col(), { stack: 3, more: [] }); // verse + two tasks: three slim blocks, no "more"
    await page.evaluate((d) => { const l = JSON.parse(localStorage.getItem('lc.tasks')); l.push({ id: 'c', title: 'Task C', date: d, min: 420, repeat: 'none', notes: '', done: {} }); localStorage.setItem('lc.tasks', JSON.stringify(l)); }, day);
    await page.reload();
    await page.waitForSelector('.tile.card');
    assert.deepEqual(await col(), { stack: 2, more: ['+2 more'] }); // four things: two blocks and "+2 more"
    await context.close();
  });
  it('adds a task from the + menu and shows it on the calendar and in the Day plan', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card');
    await page.waitForSelector('.banner');
    await page.$eval('.fab', (b) => b.scrollIntoView({ block: 'center' }));
    await page.click('.fab');
    await page.click('.fab-item');
    await page.waitForSelector('.task-sheet [role="dialog"]');
    assert.equal(await page.$eval('.task-sheet [role="dialog"]', (d) => d.getAttribute('aria-label')), 'Add a task');
    assert.equal(await page.evaluate(() => document.activeElement.name), 'task-title');
    await shot(page, 'home-task-sheet');
    await page.click('.task-sheet .sheet-done');
    await waitText(page, 'Please say what the task is.', '.task-sheet');
    await setField(page, 'task-title', 'Call a friend');
    await setField(page, 'task-date', TODAY);
    await setField(page, 'task-time', '10:15');
    await setField(page, 'task-repeat', 'weekly');
    await setField(page, 'task-notes', 'Ask how the move went');
    assert.match(await page.$eval('.task-sheet a[href^="https://calendar.google.com"]', (a) => decodeURIComponent(a.href)), /text=Call a friend.*dates=\d{8}T101500\/\d{8}T111500.*recur=RRULE:FREQ=WEEKLY/);
    assert.match(await page.$eval('.task-sheet a[download]', (a) => decodeURIComponent(a.href)), /RRULE:FREQ=WEEKLY[\s\S]*SUMMARY:Call a friend/);
    await page.click('.task-sheet .sheet-done');
    await page.waitForFunction(() => !document.querySelector('.task-sheet'));
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('lc.tasks')));
    assert.equal(saved.length, 1);
    assert.deepEqual({ ...saved[0], id: undefined }, { id: undefined, title: 'Call a friend', date: TODAY, min: 615, repeat: 'weekly', notes: 'Ask how the move went', done: {} });
    await page.waitForFunction(() => [...document.querySelectorAll('.tile.card .t')].some((e) => e.textContent === 'Call a friend'));
    assert.ok((await page.$$eval('.rail-row', (els) => els.map((e) => e.textContent))).includes('10:15 AM'));
    await shotEl(page, '.cal', 'home-calendar-task');
    await context.close();
  });
});

describe('Day plan', () => {
  const titles = (page) => page.$$eval('.dp-card .what b', (els) => els.map((e) => e.textContent));
  const progressText = (page) => text(page, '.dp-label');
  const settled = (page) => page.waitForFunction(() => document.querySelector('.dp-list')?.dataset.events === 'loaded' && document.querySelector('.dp-card'));

  it('lists the day in time order, ticks the daily items, and counts what is done', async () => {
    const day = addDays(TODAY, 2);
    const { page, errors, context } = await open(`#/day/${day}`);
    await settled(page);
    await page.waitForFunction(() => document.querySelectorAll('.dp-card').length === 4);
    assert.deepEqual(await titles(page), ['Verse of the day', 'Morning devotion', 'Prayer time', 'Cell group night']);
    assert.match(await progressText(page), /Schedule.*0 of 4 done/s);
    assert.equal((await page.$$('.dp-day')).length, 7);
    assert.equal(await page.$eval('.dp-day.on', (b) => b.getAttribute('aria-pressed')), 'true');
    assert.match(await text(page, '.dp-day.on .sr'), /0 of 4 done/);
    assert.equal(await page.$eval('.dp-card:nth-child(4) .dp-act', (a) => a.getAttribute('href')), '#/events/e1');
    await shot(page, 'day-plan');
    await page.click('.dp-card:nth-child(1) button.st');
    await waitText(page, '1 of 4 done', '.dp-label');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('lc.daily'))), { [day]: ['verse'] });
    assert.equal(await page.evaluate(() => document.activeElement.closest('.dp-card')?.querySelector('.what b').textContent), 'Verse of the day'); // focus stays on the tick
    await page.click('.dp-card:nth-child(1) button.st');
    await waitText(page, '0 of 4 done', '.dp-label');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc.daily')), '{}');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('moves between weeks and days, and shows today first with "Up next"', async () => {
    const { page, context } = await open(`#/day/${TODAY}`);
    await settled(page);
    await page.waitForSelector('.dp-card');
    assert.match(await progressText(page), /Today, /);
    assert.equal(await page.$eval('.dp-card.hot .st', (s) => s.textContent.replace(/,.*/, '')), 'Up next');
    const month = await text(page, '.dp-range');
    await page.click('[aria-label="Next week"]');
    await page.waitForFunction((d) => location.hash !== `#/day/${d}`, {}, TODAY);
    assert.equal(await page.evaluate(() => location.hash), `#/day/${addDays(TODAY, 7)}`);
    assert.ok((await text(page, '.dp-label')).length > 0);
    await page.click('.dp-day:nth-child(1)');
    assert.match(await page.evaluate(() => location.hash), /^#\/day\/\d{4}-\d{2}-\d{2}$/);
    assert.ok(month.length > 0);
    await context.close();
  });

  it('opens a day that is not a real date as today', async () => {
    const { page, context } = await open('#/day/not-a-date');
    await page.waitForSelector('.dp-card');
    assert.match(await progressText(page), /Today, /);
    await context.close();
  });

  it('adds, ticks, changes and deletes a task, and a daily task shows on the next day too', async () => {
    const day = addDays(TODAY, 1);
    const { page, context } = await open(`#/day/${day}`);
    await settled(page);
    await page.waitForSelector('.dp-card');
    await page.click('.dp-add');
    await page.waitForSelector('.task-sheet [role="dialog"]');
    assert.equal(await page.$eval('[name="task-date"]', (el) => el.value), day);
    await setField(page, 'task-title', 'Walk in the park');
    await setField(page, 'task-time', '06:30');
    await setField(page, 'task-repeat', 'daily');
    await page.click('.task-sheet .sheet-done');
    await page.waitForFunction(() => !document.querySelector('.task-sheet'));
    assert.deepEqual((await titles(page)).slice(0, 2), ['Walk in the park', 'Verse of the day']);
    assert.match(await text(page, '.dp-card:nth-child(1) .what small'), /Repeats every day/);
    // wait for the next day's own page: the old one also shows this task for a moment
    await page.evaluate(() => { window.__oldList = document.querySelector('.dp-list'); });
    await goto(page, `/day/${addDays(day, 1)}`);
    await page.waitForFunction(() => { const l = document.querySelector('.dp-list'); return l && l !== window.__oldList && l.dataset.events === 'loaded' && document.querySelector('.dp-card .what b')?.textContent === 'Walk in the park'; });
    await page.click('.dp-card:nth-child(1) button.st');
    await waitText(page, 'Done', '.dp-card:nth-child(1)');
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('lc.tasks')));
    assert.deepEqual(saved[0].done, { [addDays(day, 1)]: true });
    await page.click('.dp-card:nth-child(1) .dp-act');
    await page.waitForSelector('.task-sheet [role="dialog"]');
    assert.equal(await page.$eval('.task-sheet [role="dialog"]', (d) => d.getAttribute('aria-label')), 'Change your task');
    assert.match(await text(page, '.task-sheet'), /Changing this changes every day it repeats/);
    await setField(page, 'task-title', 'Walk by the river');
    await page.click('.task-sheet .sheet-done');
    await page.waitForFunction(() => document.querySelector('.dp-card .what b')?.textContent === 'Walk by the river');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('lc.tasks')))[0].done, { [addDays(day, 1)]: true }); // ticks survive a change
    await page.click('.dp-card:nth-child(1) .dp-act');
    await page.waitForSelector('.task-sheet [role="dialog"]');
    await page.click('.sheet-delete');
    assert.equal(await page.$eval('.sheet-confirm', (c) => c.hidden), false);
    await page.click('.sheet-confirm .btn:nth-child(2)'); // Keep it
    assert.equal(await page.$eval('.sheet-delete', (b) => b.hidden), false);
    await page.click('.sheet-delete');
    await page.click('.sheet-confirm .btn.danger');
    await page.waitForFunction(() => !document.querySelector('.task-sheet'));
    assert.equal(await page.evaluate(() => localStorage.getItem('lc.tasks')), '[]');
    assert.ok(!(await titles(page)).includes('Walk by the river'));
    await context.close();
  });

  it('closes the task sheet with Escape and gives focus back', async () => {
    const { page, context } = await open(`#/day/${TODAY}`);
    await settled(page);
    await page.waitForSelector('.dp-card');
    await page.focus('.dp-add');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.task-sheet');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.task-sheet'));
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dp-add');
    await context.close();
  });

  it('shows the signed-in member\'s own room bookings, and asks for nobody else\'s', async () => {
    const day = addDays(TODAY, 1);
    const fake = fakeBooking();
    fake.bookings.push({ id: 'LCC-E-MINE01', status: 'Approved', facility: 'Empower Room', date: day, start: '14:30', end: '16:00', org: 'Youth', canCancel: false });
    fake.bookings.push({ id: 'LCC-E-OLD001', status: 'Cancelled', facility: 'Foyer', date: day, start: '09:00', end: '10:00', org: 'Youth', canCancel: false });
    const { page, context } = await open(`#/day/${day}`, { setup: (p) => fake.install(p, { signedIn: true }) });
    await page.waitForFunction(() => [...document.querySelectorAll('.dp-card .what b')].some((e) => e.textContent === 'Empower Room booking'));
    assert.equal((await titles(page)).filter((t) => t.includes('booking')).length, 1); // a cancelled booking is left out
    assert.match(await text(page, '.dp-card:nth-child(4) .what small'), /Approved · Facilities/);
    assert.equal(await page.$eval('.dp-card:nth-child(4) .dp-act', (a) => a.getAttribute('href')), '#/booking');
    assert.deepEqual([...new Set(fake.calls.map((c) => c.action))], ['myBookings']);
    await shot(page, 'day-plan-booking');
    await goto(page, '/');
    await page.waitForFunction(() => [...document.querySelectorAll('.tile.card .t')].some((e) => e.textContent === 'Empower Room booking'));
    await page.$eval('.days', (d) => { d.scrollLeft += 100; });
    await new Promise((r) => setTimeout(r, 700));
    await shotEl(page, '.cal', 'home-calendar-booking');
    await context.close();
  });

  it('shows no bookings, and asks for none, when the member has not signed in for booking', async () => {
    const fake = fakeBooking();
    const { page, context } = await open(`#/day/${TODAY}`, { setup: (p) => fake.install(p) });
    await settled(page);
    await page.waitForSelector('.dp-card');
    await goto(page, '/');
    await page.waitForSelector('.tile.card');
    assert.deepEqual(fake.calls, []);
    await context.close();
  });

  it('has no accessibility violations, with or without the task sheet', async () => {
    const { page, context } = await open(`#/day/${addDays(TODAY, 2)}`);
    await settled(page);
    await page.waitForFunction(() => document.querySelectorAll('.dp-card').length === 4);
    await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'));
    await checkAccessibility(page, 'Day plan');
    await page.click('.dp-add');
    await page.waitForSelector('.task-sheet [role="dialog"]');
    await shot(page, 'day-plan-sheet');
    await checkAccessibility(page, 'Task sheet');
    await context.close();
  });
});

describe('Staff page', () => {
  it('asks to sign in when signed out', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    assert.equal(await page.$eval('.tabbar', (n) => getComputedStyle(n).display), 'none');
    await shot(page, 'staff-signed-out');
    await checkAccessibility(page, 'Staff sign-in');
    await context.close();
  });
  it('turns away an account that is not on the staff list', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await page.evaluate(async () => {
      const { getAuthTools } = await import('/app/js/firebase.js');
      const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
      const { auth } = await getAuthTools();
      await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'v', email: 'visitor@example.com', email_verified: true })));
    });
    await waitText(page, 'visitor@example.com is not on the staff list.');
    assert.equal(await page.$('form'), null);
    await page.click('button::-p-text(Sign out)');
    await waitText(page, 'Sign in with Google');
    await context.close();
  });
  it('shows a leader that they cannot post, with no forms', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, LEADER);
    await waitText(page, `Signed in as ${LEADER} (leader)`);
    await waitText(page, "can't post notices, verses or events");
    assert.equal(await page.$('form'), null);
    assert.equal(await page.$('.switch'), null);
    await context.close();
  });
  it('lets staff post, edit and delete a church notice, which then shows in Notifications', async () => {
    const { page, errors, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    assert.equal(await page.$('button::-p-text(Staff)'), null, 'staff should not see the Staff section');
    assert.deepEqual(await page.$$eval('.switch button', (els) => els.map((e) => e.textContent)), ['Notices', 'Verses', 'Events']);
    await waitText(page, 'Secret notice'); // staff see drafts

    await page.type('#announcements-title', 'Youth night moved');
    await page.type('#announcements-body', 'Now at 7pm.');
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.');
    await waitText(page, 'Youth night moved', '.items');
    await shot(page, 'staff-notices');

    const viewer = await open('#/notifications');
    await waitText(viewer.page, 'Youth night moved');
    await viewer.context.close();

    await page.click('button[aria-label="Edit Youth night moved"]');
    await page.$eval('#announcements-title', (el) => { el.value = ''; });
    await page.type('#announcements-title', 'Youth night is at 7pm');
    await page.click('form button[type=submit]');
    await waitText(page, 'Youth night is at 7pm', '.items');
    assert.doesNotMatch(await text(page, '.items'), /Youth night moved/);

    await page.click('button[aria-label="Delete Youth night is at 7pm"]');
    await page.waitForFunction(() => !document.querySelector('.items').innerText.includes('Youth night is at 7pm'));
    assert.deepEqual(errors, []);
    await checkAccessibility(page, 'Staff page');
    await context.close();
  });
  it('lets staff schedule a verse, and lists events with Create, Edit and Delete', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);

    await page.click('button[aria-pressed]::-p-text(Verses)');
    const tomorrow = addDays(TODAY, 1);
    await page.waitForSelector('#verses-reference');
    await page.type('#verses-reference', 'John 3:16');
    await page.type('#verses-text', 'For God so loved the world, that he gave his only begotten Son.');
    await page.click('form button[type=submit]');
    await waitText(page, `${tomorrow} · John 3:16`, '.items');

    await page.click('button[aria-pressed]::-p-text(Events)');
    await page.waitForSelector('a.btn::-p-text(Create event)');
    assert.equal(await page.$eval('a.btn.primary', (a) => a.getAttribute('href')), '#/events/new');
    assert.equal(await page.$('form'), null);
    await waitText(page, 'Cell group night', '.items');
    assert.match(await text(page, '.items'), /Yishun · Cell groups/);
    assert.equal(await page.$eval('a[aria-label="Edit Cell group night"]', (a) => a.getAttribute('href')), '#/events/e1/edit');
    await waitText(page, 'Secret draft event', '.items'); // staff see drafts
    await context.close();
  });
  it('lets an admin manage the staff list, make someone a leader, but not remove themselves', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, ADMIN);
    await waitText(page, `Signed in as ${ADMIN}`);
    await page.click('button[aria-pressed]::-p-text(Staff)');
    await page.waitForSelector('#staff-email');
    await page.type('#staff-email', 'New.Leader@LifeCentre.sg');
    await page.type('#staff-name', 'New Leader');
    await page.select('#staff-role', 'leader');
    await page.click('form button[type=submit]');
    await waitText(page, 'new.leader@lifecentre.sg', '.items');
    await waitText(page, 'leader', '.items');
    assert.equal(await page.$eval(`button[aria-label="Delete ${ADMIN}"]`, (b) => b.disabled), true);
    await shot(page, 'staff-admin');
    await page.click('button[aria-label="Delete New Leader"]');
    await page.waitForFunction(() => !document.querySelector('.items').innerText.includes('New Leader'));
    await context.close();
  });
});

describe('Contact us', () => {
  // The church numbers are not known yet, so sites.js has none. This serves a copy of it with two numbers, to test the cards.
  const withNumbers = async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (!req.url().includes('/app/js/sites.js')) return req.continue();
      const src = readFileSync(new URL('../js/sites.js', import.meta.url), 'utf8').replace("whatsapp: ''", "whatsapp: '9123 4567'").replace("phone: ''", "phone: '+65 6123 4567'");
      return req.respond({ status: 200, contentType: 'text/javascript', body: src });
    });
  };

  it('lists email, prayer request, plan a visit and a map link, and no "coming soon"', async () => {
    const { page, errors, context } = await open('#/contact');
    assert.equal(await pageTitle(page), 'Contact us');
    assert.equal((await page.$$('.ct-reach')).length, 0, 'no WhatsApp or Call card while the numbers are empty');
    const rows = await page.$$eval('.ct-rows .ct-row', (els) => els.map((e) => [e.querySelector('.ct-row-title').textContent, e.getAttribute('href')]));
    assert.deepEqual(rows, [['Email', 'mailto:hello@lifecentre.sg'], ['Prayer request', 'mailto:hello@lifecentre.sg?subject=Prayer%20request'], ['Plan a visit', null]]);
    const map = await page.$eval('.ct-map', (a) => ({ href: a.href, text: a.textContent }));
    assert.match(map.href, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=3%20Yishun%20Street%2011/);
    assert.match(map.text, /Find us\s*3 Yishun Street 11, Singapore 768645/);
    assert.doesNotMatch(await page.$eval('body', (b) => b.innerText), /coming soon/i);
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('opens the service times for all four sites under "Plan a visit"', async () => {
    const { page, context } = await open('#/contact');
    assert.equal(await page.$eval('#visit', (e) => e.hidden), true);
    await page.click('button.ct-row');
    assert.equal(await page.$eval('button.ct-row', (b) => b.getAttribute('aria-expanded')), 'true');
    assert.deepEqual(await page.$$eval('#visit h3', (els) => els.map((e) => e.textContent)), ['Life Centre @ Yishun', 'Life Centre @ Tuas', 'Life Centre @ Kranji', 'Life Centre @ Pasir Ris']);
    assert.match(await text(page, '#visit'), /English Service\s*Every Sunday, 10\.30am/);
    assert.match(await page.$eval('#visit .ct-addr', (a) => a.href), /google\.com\/maps\/search\/\?api=1&query=3%20Yishun/);
    await shot(page, 'contact-visit');
    await page.click('button.ct-row');
    assert.equal(await page.$eval('#visit', (e) => e.hidden), true);
    await context.close();
  });
  it('shows the WhatsApp and Call cards with working links once the numbers are set', async () => {
    const { page, context } = await open('#/contact', { setup: withNumbers });
    await page.waitForSelector('.ct-reach');
    const cards = await page.$$eval('.ct-reach', (els) => els.map((e) => ({ title: e.querySelector('.ct-reach-title').textContent, sub: e.querySelector('.ct-reach-sub').textContent, href: e.getAttribute('href') })));
    assert.deepEqual(cards, [
      { title: 'WhatsApp', sub: '9123 4567', href: 'https://wa.me/6591234567' },
      { title: 'Call', sub: '+65 6123 4567', href: 'tel:+6561234567' },
    ]);
    await shot(page, 'contact-numbers');
    await context.close();
  });
  it('is the fifth tab for visitors and has no accessibility violations', async () => {
    const { page, context } = await open('#/contact');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'contact');
    await shot(page, 'contact');
    await checkAccessibility(page, 'Contact us');
    const withCards = await open('#/contact', { setup: withNumbers });
    await withCards.page.waitForSelector('.ct-reach');
    await checkAccessibility(withCards.page, 'Contact us with numbers');
    await withCards.context.close();
    await context.close();
  });
});

describe('Giving', () => {
  it('shows the intro, the scam warning and a PayNow card for each account', async () => {
    const { page, errors, context } = await open('#/giving');
    assert.equal(await pageTitle(page), 'Giving via PayNow');
    assert.equal(await text(page, '.screen-head .light'), 'via PayNow');
    assert.match(await text(page, '.gv-intro'), /give your tithes and offerings via PayNow UENs/);
    const warn = await page.$eval('.gv-warn', (e) => ({ role: e.getAttribute('role'), text: e.innerText }));
    assert.equal(warn.role, 'note');
    assert.match(warn.text, /Important: to avoid scams/);
    assert.match(warn.text, /Life Centre - Tithes & Offering/);
    assert.match(warn.text, /Life Centre - Building Fund/);
    assert.match(warn.text, /ensure that the UEN number is correct/);
    assert.deepEqual(await page.$$eval('.gv-fund', (els) => els.map((e) => [e.querySelector('.gv-title').textContent, e.querySelector('.gv-uen').textContent])), [
      ['Life Centre (Tithes, Offering)', 'S87SS0049C'],
      ['Life Centre (Building Fund)', 'S87SS0049CBLD'],
    ]);
    assert.equal((await page.$$('.gv-qr')).length, 2, 'a QR space in each card');
    assert.equal(await page.$('.gv-qr img'), null, 'the QR spaces stay blank');
    assert.match(await text(page, '.gv-foot'), /recorded as anonymous/);
    assert.match(await text(page, '.gv-source'), /Source: lifecentre\.sg/);
    assert.doesNotMatch(await page.$eval('body', (b) => b.innerText), /coming soon/i);
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('copies a UEN, says "Copied", then goes back to "Copy"', async () => {
    const { page, context } = await open('#/giving');
    const buttons = await page.$$('.gv-copy');
    assert.equal(await buttons[1].evaluate((b) => b.getAttribute('aria-label')), 'Copy the UEN number for Life Centre (Building Fund)');
    await buttons[1].click();
    await page.waitForFunction(() => document.querySelectorAll('.gv-copy')[1].textContent.trim() === 'Copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'S87SS0049CBLD');
    assert.match(await text(page, '[role=status]'), /UEN copied/);
    assert.equal(await page.$eval('.gv-copy', (b) => b.textContent.trim()), 'Copy', 'the other card is unchanged');
    await page.waitForFunction(() => document.querySelectorAll('.gv-copy')[1].textContent.trim() === 'Copy', { timeout: 4000 });
    await buttons[0].click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'S87SS0049C');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/giving');
    await shot(page, 'giving');
    await page.$eval('.gv-fund:last-of-type', (e) => e.scrollIntoView());
    await shot(page, 'giving-bottom');
    await checkAccessibility(page, 'Giving');
    await context.close();
  });
});

describe('Watch', () => {
  const resumeAt = (id, t) => (page) => page.evaluateOnNewDocument((state) => localStorage.setItem('lc:v1:watchResume', JSON.stringify(state)), { id, t });
  const current = (page) => page.$eval('.wt-title', (e) => e.textContent);
  const waitCurrent = (page, title) => page.waitForFunction((t) => document.querySelector('.wt-title')?.textContent === t, { timeout: 8000 }, title);
  const progress = (page) => page.$eval('.wt-bar', (e) => Number(e.getAttribute('aria-valuenow')));
  // the feed has come to rest exactly on video number `index` (counting from 0)
  const waitRestedOn = (page, index) => page.waitForFunction((i) => { const f = document.querySelector('.wt-feed'); return Math.abs(f.scrollTop / f.clientHeight - i) < 0.02; }, { timeout: 8000 }, index);

  it('opens on the first sample video with the Sample label, a progress line and the tab bar', async () => {
    const { page, errors, context } = await open('#/watch');
    assert.equal(await pageTitle(page), 'Watch');
    assert.equal((await page.$$('.wt-slide')).length, 6);
    assert.equal(await current(page), 'Sunday message in 60 seconds');
    assert.equal(await text(page, '.wt-chip'), 'Sample');
    assert.equal(await text(page, '.wt-caption'), 'Sample videos');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'watch');
    assert.ok(await page.$eval('.tabbar', (e) => e.getBoundingClientRect().height > 0));
    await page.waitForFunction(() => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) >= 2, { timeout: 6000 });
    assert.match(await page.$eval('.wt-bar', (e) => e.getAttribute('aria-valuetext')), /^0:0[2-9] of 0:58$/);
    await shot(page, 'watch');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('pauses and resumes when the feed is tapped', async () => {
    const { page, context } = await open('#/watch');
    await page.waitForFunction(() => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) >= 1, { timeout: 6000 });
    await page.mouse.click(195, 400);
    await page.waitForSelector('.wt-pause.on');
    const frozen = await progress(page);
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(await progress(page), frozen, 'the progress line stops while paused');
    await shot(page, 'watch-paused');
    await page.mouse.click(195, 400);
    await page.waitForFunction((n) => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) > n, { timeout: 4000 }, frozen);
    assert.equal(await page.$('.wt-pause.on'), null);
    await context.close();
  });
  it('turns sound on and off and remembers the choice', async () => {
    const { page, context } = await open('#/watch');
    assert.equal(await page.$eval('.wt-sound', (b) => b.getAttribute('aria-label')), 'Turn sound on');
    await page.click('.wt-sound');
    assert.equal(await page.$eval('.wt-sound', (b) => b.getAttribute('aria-label')), 'Mute');
    await page.reload();
    await page.waitForSelector('.wt-sound');
    assert.equal(await page.$eval('.wt-sound', (b) => b.getAttribute('aria-label')), 'Mute');
    await page.click('.wt-sound');
    assert.equal(await page.$eval('.wt-sound', (b) => b.getAttribute('aria-label')), 'Turn sound on');
    await context.close();
  });
  it('moves to the next video with the keyboard and with a mouse drag, and starts it from the beginning', async () => {
    const { page, context } = await open('#/watch');
    await page.waitForFunction(() => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) >= 1, { timeout: 6000 });
    await page.focus('.wt-feed');
    await page.keyboard.press('ArrowDown');
    await waitCurrent(page, 'Memory verse of the week');
    assert.match(await text(page, '[role=status].sr'), /Video 2 of 6: Memory verse of the week/);
    assert.ok(await progress(page) <= 1, 'the new video starts at the beginning');
    // drag up with the mouse: the feed snaps to the next whole video
    await page.mouse.move(195, 500);
    await page.mouse.down();
    for (let y = 500; y >= 300; y -= 25) await page.mouse.move(195, y);
    await page.mouse.up();
    await waitCurrent(page, 'Testimony: an answered prayer');
    await waitRestedOn(page, 2); // snapped to the third video, not left half way
    assert.equal(await page.$('.wt-pause.on'), null, 'a drag is not a tap');
    // and back down
    await page.mouse.move(195, 300);
    await page.mouse.down();
    for (let y = 300; y <= 520; y += 30) await page.mouse.move(195, y);
    await page.mouse.up();
    await waitCurrent(page, 'Memory verse of the week');
    await waitRestedOn(page, 1);
    await shot(page, 'watch-next');
    await context.close();
  });
  it('says "Continue where you left off" and goes back to the video the member stopped at', async () => {
    const { page, context } = await open('#/watch', { setup: resumeAt('sample-v3', 20) });
    await page.waitForFunction(() => document.querySelector('.wt-toast.on'), { timeout: 4000 });
    assert.equal(await text(page, '.wt-toast'), 'Continue where you left off · 0:20');
    await waitCurrent(page, 'Testimony: an answered prayer');
    assert.ok(await progress(page) >= 20);
    await shot(page, 'watch-resume');
    await page.waitForFunction(() => !document.querySelector('.wt-toast.on'), { timeout: 6000 });
    // leaving and coming back keeps the place
    await goto(page, '/giving');
    await goto(page, '/watch');
    assert.equal(await current(page), 'Testimony: an answered prayer');
    await context.close();
  });
  it('does not offer to continue when the saved place is the very start, or when the video is unknown', async () => {
    for (const setup of [resumeAt('sample-v2', 1), resumeAt('gone', 30)]) {
      const { page, context } = await open('#/watch', { setup });
      assert.equal(await page.$('.wt-toast.on'), null);
      await context.close();
    }
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open('#/watch');
    await checkAccessibility(page, 'Watch');
    await context.close();
  });
});

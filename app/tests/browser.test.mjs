// The real screens in a real browser (Edge or Chrome, headless) against the local emulators.
// Run with: npm run test:browser   (set BROWSER_PATH to use a different browser; SHOT_DIR to save screenshots)
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, Timestamp } from 'firebase/firestore';
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
  // A fake camera and microphone, allowed without asking, and media that plays without a tap: for the story tests.
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
  await page.setViewport({ width, height, deviceScaleFactor: Number(process.env.SHOT_DPR) || 1 }); // SHOT_DPR=2 for sharper review screenshots
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

async function signIn(page, email, name) { // name: the Google account's display name, when a test needs one
  await page.evaluate(async (mail, n) => {
    const { getAuthTools } = await import('/app/js/firebase.js');
    const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
    const { auth } = await getAuthTools();
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `id-${mail}`, email: mail, email_verified: true, ...(n ? { name: n } : {}) })));
  }, email, name);
  await page.waitForFunction((m) => JSON.parse(localStorage.getItem('lc:v1:session') || 'null')?.email === m, { timeout: 15000 }, email);
}

// Signs in on a first page, then returns the page ready to use (the role is saved on the phone for the next screens).
async function openAsStaff(path = '/events', email = STAFF, size = {}) {
  const opened = await open('#/staff', size);
  await waitText(opened.page, 'Sign in with Google');
  await signIn(opened.page, email);
  await goto(opened.page, path);
  return opened;
}

describe('Home', () => {
  it('shows the greeting, verse, "Coming up" banner (the pinned event) and church calendar', async () => {
    const { page, errors, context } = await open();
    await waitText(page, 'Psalm 23:1');
    assert.match(await text(page, '#page-title .sr'), /^Good (morning|afternoon|evening)\. [A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+$/);
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
  it('opens the Account page from the avatar, which links on to Contact us', async () => {
    const { page, context } = await open();
    assert.equal(await page.$eval('.avatar', (a) => a.getAttribute('href')), '#/account');
    assert.equal(await page.$eval('.avatar', (a) => a.getAttribute('aria-label')), 'Account, sign in');
    assert.equal(await page.$$eval('.avatar svg', (s) => s.length), 1); // a person icon while nobody is signed in
    await page.click('.avatar');
    await waitTitle(page, 'Account');
    assert.match(page.url(), /#\/account$/);
    await page.click('.acct-contact');
    await waitTitle(page, 'Contact us');
    await context.close();
  });
  it('lists Facilities Booking Request in the + menu', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile.card'); // let the calendar finish drawing first
    await page.waitForSelector('.banner');
    await page.$eval('.fab', (b) => b.scrollIntoView({ block: 'center' })); // it sits at the bottom of the calendar card
    await page.click('.fab');
    assert.deepEqual(await page.$$eval('#fab-menu > *', (els) => els.map((e) => e.textContent.trim())), ['Add a task', 'Book a space']);
    assert.match(await text(page, '#fab-menu a'), /Book a space/);
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
    assert.equal(await visitor.page.$eval('.fab-layer', (a) => a.hidden), true);
    await visitor.context.close();
    for (const [email, shown] of [[STAFF, true], [ADMIN, true], [LEADER, false]]) {
      const { page, context } = await openAsStaff('/events', email);
      await page.waitForSelector('.ev-row');
      assert.equal(await page.$eval('.fab-layer', (a) => a.hidden), !shown, email);
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
  it('opens the Contact sheet with the church email, WhatsApp and phone', async () => {
    const { page, context } = await open('#/events/e1');
    await waitTitle(page, 'Cell group night');
    await page.click('.acts > button.act::-p-text(Contact)');
    await page.waitForSelector('[role=dialog]');
    assert.match(await text(page, '[role=dialog]'), /Contact the organiser.*Discipleship Team/s);
    assert.match(await page.$eval('[role=dialog] a[href^="mailto:"]', (a) => a.href), /^mailto:hello@lifecentre\.sg\?subject=About%3A%20Cell%20group%20night$/);
    assert.deepEqual(await page.$$eval('[role=dialog] .sheet-row', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent, e.getAttribute('href').replace(/\?.*/, '')])), [
      ['Email', 'hello@lifecentre.sg', 'mailto:hello@lifecentre.sg'],
      ['WhatsApp', '+65 9655 3787', 'https://wa.me/6596553787'],
      ['Call the office', '+65 9655 3787', 'tel:+6596553787'],
    ]);
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
function fakeBooking({ blocks = [], failure = null, delays = {}, past = [], notStaff = false } = {}) {
  const TOKEN = 'a'.repeat(64);
  const state = { calls: [], bookings: [], blocks, failure, past, notStaff };
  const reply = (body) => {
    const { action, token } = body;
    if (state.failure?.[action]) return state.failure[action];
    if (action === 'requestCode') return { ok: true, message: 'If this email is on our member list, a 6-digit code is on its way. It expires in 10 minutes.' };
    if (action === 'verifyCode') {
      return body.code === '123456'
        ? { ok: true, token: TOKEN, user: { name: 'Test Member', email: body.email } }
        : { ok: false, code: 'error', error: 'That code is not right. Check the email and try again.' };
    }
    if (action === 'staffSignIn') { // a Google sign-in from the staff list (the real system checks the token with Google)
      return typeof body.idToken === 'string' && body.idToken && !state.notStaff
        ? { ok: true, token: TOKEN, user: { name: 'Staff Member', email: 'staff@lifecentre.sg' } }
        : { ok: false, code: 'notstaff', error: 'This Google account is not set up for bookings.' };
    }
    if (token !== TOKEN) return { ok: false, code: 'signin', error: 'Please sign in again.' };
    if (action === 'config') return { ok: true, rooms: ['Whole Church', 'Main Sanctuary', 'Empower Room', 'Foyer', 'Dining Area', 'Cry Room', 'Carpark'], today: TODAY, maxDate: addDays(TODAY, 365), dayStart: '07:00', dayEnd: '23:00' };
    if (action === 'availability') return { ok: true, facility: body.facility, date: body.date, blocks: state.blocks };
    if (action === 'myBookings') return { ok: true, upcoming: state.bookings, past: state.past };
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
      const send = () => req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(body)) });
      if (delays[body.action]) setTimeout(send, delays[body.action]); else send();
    });
  };
  return state;
}
// Scrolls a control to the middle of the screen first, so the bottom tab bar never covers it, then taps it.
const tap = async (page, selector) => { await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' })); await page.click(selector); };
const setField = (page, name, value) => page.$eval(`[name="${name}"]`, (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', { bubbles: true }));
}, value);

describe('Facilities booking', () => {
  it('asks a visitor to sign in with an emailed code, then shows the code step, and passes the accessibility check', async () => {
    const fake = fakeBooking();
    const { page, errors, context } = await open('#/booking', { setup: (p) => fake.install(p) });
    await waitTitle(page, 'Account'); // one sign-in page for the whole app
    assert.match(page.url(), /#\/account\?next=booking$/);
    await page.waitForSelector('#bk-email');
    assert.match(await text(page, '#main'), /We’ll email you a 6‑digit code\. No password needed\./);
    assert.match(await text(page, '#main'), /Need help\?\s*Contact us/);
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

  it('signs in with the right code on Account, comes back to booking, keeps the session, and signs out', async () => {
    const fake = fakeBooking();
    const { page, context } = await open('#/booking', { setup: (p) => fake.install(p) });
    await waitTitle(page, 'Account');
    await page.waitForSelector('#bk-email');
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
    await waitTitle(page, 'Book a space');
    await page.waitForSelector('.bs-pill');
    assert.equal((await page.$$('.bs-pill')).length, 7);
    assert.match(await text(page, '#main'), /No upcoming bookings\./);
    assert.match(await text(page, '#main'), /Signed in as member@example\.org/);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session'))).token.length, 64);
    await shot(page, 'booking-home');
    await checkAccessibility(page, 'Booking home');
    await page.reload();
    await page.waitForSelector('.bs-pill'); // still signed in
    await page.$eval('.bk-signed .btn', (b) => b.scrollIntoView({ block: 'center' })); // it sits at the bottom of the page
    await page.click('.bk-signed .btn');
    await waitTitle(page, 'Account');
    await page.waitForSelector('#bk-email');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    assert.ok(fake.calls.some((c) => c.action === 'signOut' && c.token.length === 64));
    await context.close();
  });

  it('books a space on one page: pills, timeline, hours, a blocked clash, Confirm opens the details, and the booking joins the slider', async () => {
    const fake = fakeBooking({ blocks: [{ start: '14:00', end: '16:00', kind: 'booked', wholeChurch: false }, { start: '18:00', end: '19:00', kind: 'pending', wholeChurch: false }] });
    const { page, errors, context } = await open('#/booking', { setup: (p) => fake.install(p, { signedIn: true }) });
    await waitTitle(page, 'Book a space');
    await page.waitForSelector('.bk-slot');
    assert.deepEqual(await page.$$eval('.bs-pill', (els) => els.map((e) => [e.textContent, e.getAttribute('aria-pressed')])).then((x) => x.filter(([, on]) => on === 'true').map(([t]) => t)), ['Empower Room']);
    assert.ok((await page.$$('.bs-day')).length >= 30);
    assert.equal(await page.$eval('.bs-day[aria-pressed="true"]', (b) => b.dataset.date), addDays(TODAY, 1)); // tomorrow
    assert.equal((await page.$$('.bs-block.is-booked')).length, 1);
    assert.equal((await page.$$('.bs-block.is-requested')).length, 1);
    const slotState = () => page.$$eval('.bk-slot', (els) => els.map((el) => ({ t: el.dataset.slot, booked: el.disabled, on: el.getAttribute('aria-pressed') === 'true', label: el.querySelector('small')?.textContent ?? '' })));
    let slots = await slotState();
    assert.equal(slots.length, 16); // 07:00 to 22:00, one-hour slots
    assert.deepEqual(slots.filter((x) => x.booked).map((x) => [x.t, x.label]), [['14:00', 'Booked'], ['15:00', 'Booked']]);
    assert.equal(slots.find((x) => x.t === '18:00').label, 'Requested');
    assert.deepEqual(slots.filter((x) => x.on).map((x) => x.t), ['09:00']);
    await tap(page, '[data-slot="10:00"]');
    await tap(page, '[data-slot="11:00"]');
    assert.deepEqual(await page.$$eval('[name="start"],[name="end"]', (els) => els.map((el) => el.value)), ['09:00', '12:00']);
    assert.match(await text(page, '.bs-sum'), /09:00 – 12:00 · 3 hours/);
    await page.select('[name="start"]', '15:00');
    await page.select('[name="end"]', '17:00');
    await waitText(page, 'That time is already booked for this space.', '#main');
    assert.equal(await page.$eval('.bs-confirm', (b) => b.disabled), true);
    await tap(page, '[data-slot="16:00"]');
    await page.waitForFunction(() => document.activeElement?.dataset.slot === '16:00', { timeout: 2000 }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.slot), '16:00'); // focus stays on the tapped hour
    assert.equal(await page.$eval('.bs-confirm', (b) => b.disabled), false);
    await shot(page, 'book-space');
    await checkAccessibility(page, 'Book a space');
    await tap(page, '.bs-confirm');
    await page.waitForSelector('[name="org"]');
    assert.equal(await pageTitle(page), 'Book a space'); // the same page
    assert.match(await text(page, '.bs-summary'), /Empower Room/);
    assert.match(await text(page, '.bs-summary'), /16:00 – 17:00/);
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), true);
    await setField(page, 'org', 'TEST, please ignore');
    await setField(page, 'purpose', 'TEST, please ignore');
    await setField(page, 'attendance', '12');
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), false);
    await shot(page, 'book-space-details');
    await checkAccessibility(page, 'Book a space details');
    await tap(page, '#bk-submit');
    await waitText(page, 'Reference LCC-E-ABC234', '#main');
    assert.match(await text(page, '.bs-done'), /Booked/);
    const sent = fake.calls.find((c) => c.action === 'book');
    assert.deepEqual(Object.keys(sent).sort(), ['action', 'attendance', 'date', 'end', 'facility', 'org', 'purpose', 'setupNeeds', 'start', 'token']);
    assert.deepEqual([sent.facility, sent.start, sent.end, sent.org, sent.attendance], ['Empower Room', '16:00', '17:00', 'TEST, please ignore', '12']);
    await page.waitForSelector('#bs-mine .bs-card');
    assert.match(await text(page, '#bs-mine .bs-card'), /Empower Room/);
    assert.match(await text(page, '#bs-mine .bs-card'), /16:00–17:00/);
    assert.match(await text(page, '#bs-mine .bs-badge'), /Approved/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('Rebook: fills the same details for the next same weekday, or says it clashes', async () => {
    const past = [{ id: 'LCC-E-OLD111', status: 'Approved', facility: 'Main Sanctuary', date: addDays(TODAY, -6), start: '19:00', end: '21:00', org: 'Youth ministry', purpose: 'Youth night', canCancel: false }];
    const fake = fakeBooking({ past });
    const { page, errors, context } = await open('#/booking', { setup: (p) => fake.install(p, { signedIn: true }) });
    await page.waitForSelector('#bs-past .bs-rebook-btn');
    assert.match(await text(page, '#bs-past .bs-card'), /Youth night/);
    await tap(page, '#bs-past .bs-rebook-btn');
    await page.waitForSelector('[name="org"]');
    assert.equal(await page.$eval('[name="org"]', (el) => el.value), 'Youth ministry');
    assert.equal(await page.$eval('[name="purpose"]', (el) => el.value), 'Youth night');
    assert.match(await text(page, '.bs-rebook'), /Rebooking Youth night/);
    assert.equal(await page.$eval('.bs-pill[aria-pressed="true"]', (b) => b.textContent), 'Main Sanctuary');
    assert.equal(await page.$eval('.bs-day[aria-pressed="true"]', (b) => b.dataset.date), addDays(TODAY, 1)); // six days ago, so tomorrow is the same weekday
    assert.deepEqual(await page.$$eval('[name="start"],[name="end"]', (els) => els.map((el) => el.value)), ['19:00', '21:00']);
    await checkAccessibility(page, 'Rebook');
    assert.deepEqual(errors, []);
    await context.close();

    const busyDay = fakeBooking({ past, blocks: [{ start: '20:00', end: '22:00', kind: 'booked', wholeChurch: false }] });
    const second = await open('#/booking', { setup: (p) => busyDay.install(p, { signedIn: true }) });
    await second.page.waitForSelector('#bs-past .bs-rebook-btn');
    await tap(second.page, '#bs-past .bs-rebook-btn');
    await waitText(second.page, 'Youth night clashes with a booking', '#main');
    assert.equal((await second.page.$$('[name="org"]')).length, 0); // no details until a free time is chosen
    await second.context.close();
  });

  it('goes back to sign-in when the session has ended, and shows a message when the booking system is unwell', async () => {
    const fake = fakeBooking();
    const { page, context } = await open('#/booking', { setup: (p) => fake.install(p, { signedIn: true, token: 'b'.repeat(64) }) });
    await waitTitle(page, 'Account');
    await waitText(page, 'Your sign-in ended. Please sign in again.', '#main');
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
    const staff = await openAsStaff('/booking', STAFF, { setup: (p) => fake.install(p) });
    await waitTitle(staff.page, 'Book a space'); // signed in with Google: straight in, no emailed code
    await staff.page.waitForSelector('.bs-pill');
    assert.ok(fake.calls.some((c) => c.action === 'staffSignIn' && c.idToken));
    assert.equal(await staff.page.$('#bk-email'), null);
    assert.equal((await fifthTab(staff.page)).label, 'Facilities Booking');
    await staff.context.close();
  });

  it('a staff Google account the booking system does not know gets the code form, with a notice', async () => {
    const fake = fakeBooking({ notStaff: true });
    const { page, errors, context } = await openAsStaff('/booking', STAFF, { setup: (p) => fake.install(p) });
    await waitTitle(page, 'Account');
    await page.waitForSelector('#bk-email');
    assert.match(await text(page, '#main'), /Your Google account is not set up for bookings yet/);
    assert.deepEqual(errors, []);
    await context.close();
  });
});

describe('Account (from the Home avatar)', () => {
  it('signed out: offers member sign-in and staff sign-in, and passes the accessibility check', async () => {
    const fake = fakeBooking();
    const { page, errors, context } = await open('#/account', { setup: (p) => fake.install(p) });
    assert.equal(await pageTitle(page), 'Account');
    await page.waitForSelector('#bk-email');
    assert.match(await text(page, '#main'), /We’ll email you a 6‑digit code\. No password needed\./);
    assert.match(await text(page, '#main'), /Staff sign-in with Google/);
    assert.equal((await page.$$('.acct-me')).length, 0);
    await shot(page, 'account-signed-out');
    await checkAccessibility(page, 'Account, signed out');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('locks the code box while a code is checked, opens it again for a wrong code, then signs the member in', async () => {
    const fake = fakeBooking({ delays: { verifyCode: 900 } });
    const { page, errors, context } = await open('#/account', { setup: (p) => fake.install(p) });
    await page.type('#bk-email', 'member@example.org');
    await page.click('.cr-submit');
    await page.waitForSelector('#bk-code');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'bk-code');
    await page.type('#bk-code', '000 000'); // a pasted code may carry a space
    await page.click('.cr-submit');
    await page.waitForFunction(() => document.querySelector('#bk-code')?.readOnly === true);
    const locked = await page.$eval('#main', (m) => ({
      value: m.querySelector('#bk-code').value, busy: m.querySelector('#bk-code').getAttribute('aria-busy'),
      submit: m.querySelector('.cr-submit').disabled, label: m.querySelector('.cr-submit').textContent,
      links: [...m.querySelectorAll('.bk-links button')].map((b) => b.disabled),
    }));
    assert.deepEqual(locked, { value: '000 000', busy: 'true', submit: true, label: 'Checking…', links: [true, true] });
    await page.keyboard.type('9');
    assert.equal(await page.$eval('#bk-code', (el) => el.value), '000 000'); // nothing more can be typed while it is checked
    await waitText(page, 'That code is not right', '#main');
    assert.deepEqual(await page.$eval('#main', (m) => ({ readOnly: m.querySelector('#bk-code').readOnly, value: m.querySelector('#bk-code').value, submit: m.querySelector('.cr-submit').disabled, focus: document.activeElement?.id })),
      { readOnly: false, value: '', submit: false, focus: 'bk-code' });
    assert.equal(fake.calls.filter((c) => c.action === 'verifyCode')[0].code, '000000');
    await page.type('#bk-code', '123456');
    await page.click('.cr-submit');
    await page.waitForSelector('.acct-me');
    assert.match(await text(page, '.acct-me'), /Test Member/);
    assert.match(await text(page, '.acct-row'), /Member\s*member@example\.org/);
    assert.equal(await text(page, '.acct-av'), 'T');
    assert.equal((await page.$$('.acct-tools')).length, 0); // members get no staff tools
    await shot(page, 'account-member');
    await checkAccessibility(page, 'Account, member');
    await goto(page, '#/');
    await page.waitForFunction(() => document.querySelector('.avatar')?.textContent === 'T');
    assert.match(await page.$eval('.avatar', (a) => a.getAttribute('aria-label')), /member@example\.org/);
    await goto(page, '#/account');
    await page.waitForSelector('.acct-row .btn');
    await page.click('.acct-row .btn');
    await page.waitForSelector('#bk-email');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    assert.ok(fake.calls.some((c) => c.action === 'signOut'));
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('admin: shows the role and the admin tools, and signing out puts the fifth tab back to Contact us', async () => {
    const fake = fakeBooking();
    const { page, errors, context } = await openAsStaff('/account', ADMIN, { setup: (p) => fake.install(p) });
    await page.waitForSelector('.acct-tools');
    assert.match(await text(page, '.acct-row'), /Admin\s*admin@lifecentre\.sg/);
    assert.match(await text(page, '#acct-tools-h'), /Admin tools/);
    assert.deepEqual(await page.$$eval('.acct-links a', (as) => as.map((a) => [a.getAttribute('href'), a.textContent.trim()])), [
      ['#/staff', 'Notices, verses, events and the staff list'], ['#/events/new', 'Create an event'], ['#/watch', 'Post a video'], ['#/booking', 'Facilities booking']]);
    assert.match(await text(page, '#main'), /Sign in for bookings/);
    assert.equal((await fifthTab(page)).label, 'Facilities Booking');
    await shot(page, 'account-admin');
    await checkAccessibility(page, 'Account, admin');
    await page.click('.acct-row .btn');
    await page.waitForSelector('#bk-email');
    assert.equal((await fifthTab(page)).label, 'Contact us');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:session')), null);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('leader: staff tools for videos and bookings only; signed in both ways: one button signs out of both', async () => {
    const fake = fakeBooking();
    const { page, context } = await openAsStaff('/account', LEADER, { setup: (p) => fake.install(p, { signedIn: true }) });
    await page.waitForSelector('.acct-tools');
    assert.match(await text(page, '#acct-tools-h'), /Staff tools/);
    assert.deepEqual(await page.$$eval('.acct-links a', (as) => as.map((a) => a.getAttribute('href'))), ['#/watch', '#/booking']);
    assert.equal((await page.$$('.acct-row')).length, 2);
    await page.click('.acct-me > .btn');
    await page.waitForSelector('#bk-email');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:booking-session')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:session')), null);
    await context.close();
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
    await page.waitForSelector('#verses-book');
    await page.select('#verses-book', 'JHN');
    await page.type('#verses-chapter', '3');
    await page.type('#verses-verseFrom', '16');
    await page.click('form button[type=submit]');
    await waitText(page, `${dayLabel(tomorrow)} · John 3:16`, '.items');

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
  const withoutNumbers = async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (!req.url().includes('/app/js/sites.js')) return req.continue();
      const src = readFileSync(new URL('../js/sites.js', import.meta.url), 'utf8').replace(/whatsapp: '[^']*'/, "whatsapp: ''").replace(/phone: '[^']*'/, "phone: ''");
      return req.respond({ status: 200, contentType: 'text/javascript', body: src });
    });
  };

  it('lists email, prayer request, plan a visit and a map link, and no "coming soon"', async () => {
    const { page, errors, context } = await open('#/contact', { setup: withoutNumbers });
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
    assert.deepEqual(await page.$$eval('#visit h2', (els) => els.map((e) => e.textContent)), ['Life Centre @ Yishun', 'Life Centre @ Tuas', 'Life Centre @ Kranji', 'Life Centre @ Pasir Ris']);
    assert.match(await text(page, '#visit'), /English Service\s*Every Sunday, 10\.30am/);
    assert.match(await page.$eval('#visit .ct-addr', (a) => a.href), /google\.com\/maps\/search\/\?api=1&query=3%20Yishun/);
    await shot(page, 'contact-visit');
    await page.click('button.ct-row');
    assert.equal(await page.$eval('#visit', (e) => e.hidden), true);
    await context.close();
  });
  it('shows the WhatsApp and Call cards with working links for the church number', async () => {
    const { page, context } = await open('#/contact');
    await page.waitForSelector('.ct-reach');
    const cards = await page.$$eval('.ct-reach', (els) => els.map((e) => ({ title: e.querySelector('.ct-reach-title').textContent, sub: e.querySelector('.ct-reach-sub').textContent, href: e.getAttribute('href') })));
    assert.deepEqual(cards, [
      { title: 'WhatsApp', sub: '+65 9655 3787', href: 'https://wa.me/6596553787' },
      { title: 'Call', sub: '+65 9655 3787', href: 'tel:+6596553787' },
    ]);
    await shot(page, 'contact-numbers');
    await context.close();
  });
  it('is the fifth tab for visitors and has no accessibility violations', async () => {
    const { page, context } = await open('#/contact');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'contact');
    await shot(page, 'contact');
    await checkAccessibility(page, 'Contact us');
    await page.waitForSelector('.ct-reach');
    const withoutCards = await open('#/contact', { setup: withoutNumbers });
    await checkAccessibility(withoutCards.page, 'Contact us without numbers');
    await withoutCards.context.close();
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
    assert.equal((await page.$$('.gv-qr')).length, 2, 'a QR code in each card');
    // The code in each card belongs to that card's fund (its picture is named for the fund) and is big and white enough to scan.
    const codes = await page.$$eval('.gv-fund', (els) => els.map((e) => { const img = e.querySelector('.gv-qr img'); return { title: e.querySelector('.gv-title').textContent, src: img?.getAttribute('src'), alt: img?.alt, loaded: !!img && img.complete && img.naturalWidth > 0, width: Math.round(img?.getBoundingClientRect().width ?? 0), bg: getComputedStyle(e.querySelector('.gv-qr')).backgroundColor }; }));
    assert.deepEqual(codes.map((c) => [c.title, c.src, c.alt]), [
      ['Life Centre (Tithes, Offering)', 'images/paynow-tithes.png', 'PayNow QR code for Life Centre (Tithes, Offering)'],
      ['Life Centre (Building Fund)', 'images/paynow-building.png', 'PayNow QR code for Life Centre (Building Fund)'],
    ]);
    for (const c of codes) { assert.ok(c.loaded, `${c.src} loads`); assert.equal(c.width, 200); assert.equal(c.bg, 'rgb(255, 255, 255)'); }
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
  it('has a Save QR code button under each code, at least 44px tall', async () => {
    const { page, context } = await open('#/giving');
    const saves = await page.$$eval('.gv-fund', (els) => els.map((e) => {
      const button = e.querySelector('.gv-qr-wrap .gv-save');
      const image = e.querySelector('.gv-qr img');
      return { text: button?.textContent.trim(), height: Math.round(button?.getBoundingClientRect().height ?? 0), below: !!button && button.getBoundingClientRect().top >= image.getBoundingClientRect().bottom };
    }));
    assert.deepEqual(saves.map((b) => b.text), ['Save QR code', 'Save QR code']);
    for (const b of saves) { assert.ok(b.height >= 44, `the button is ${b.height}px tall`); assert.ok(b.below, 'the button sits under the code'); }
    await context.close();
  });
  // A share sheet that records what it was given, and a download link that records its file name instead of downloading.
  const qrStubs = (p) => p.evaluateOnNewDocument(() => {
    window.__shared = []; window.__clicks = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => { window.__shared.push(data.files.map((f) => [f.name, f.type, f.size])); if (window.__cancel) throw new DOMException('cancelled', 'AbortError'); };
    HTMLAnchorElement.prototype.click = function () { window.__clicks.push([this.download, this.href.slice(0, 5)]); };
  });
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const PNG_SIZE = { tithes: readFileSync(new URL('../images/paynow-tithes.png', import.meta.url)).length, building: readFileSync(new URL('../images/paynow-building.png', import.meta.url)).length };
  const notes = (page) => page.$$eval('.gv-fund .gv-note', (els) => els.map((e) => e.textContent));

  it('on Android, Save QR code downloads the PNG under a clear file name and says "Saved to your Downloads", never the share sheet', async () => {
    const { page, context } = await open('#/giving', { setup: async (p) => { await p.setUserAgent(ANDROID_UA); await qrStubs(p); } });
    await page.waitForSelector('.gv-save');
    const saves = await page.$$('.gv-save');
    await saves[1].click();
    await page.waitForFunction(() => window.__clicks.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__clicks), [['life-centre-paynow-building-fund.png', 'blob:']]);
    assert.deepEqual(await notes(page), ['', 'Saved to your Downloads'], 'the note sits under that card\'s buttons');
    assert.equal(await text(page, '[role=status]'), 'Saved to your Downloads', 'and is read out');
    await saves[0].click();
    await page.waitForFunction(() => window.__clicks.length === 2);
    assert.equal(await page.evaluate(() => window.__clicks[1][0]), 'life-centre-paynow-tithes-offering.png');
    assert.deepEqual(await page.evaluate(() => window.__shared), [], 'Save never opens the share sheet on Android');
    await page.waitForFunction(() => document.querySelectorAll('.gv-note')[1].textContent === '', { timeout: 6000 });
    await context.close();
  });
  it('on a computer, Save QR code downloads the PNG the same way', async () => {
    const { page, context } = await open('#/giving', { setup: qrStubs }); // headless Edge: a desktop user agent
    await page.waitForSelector('.gv-save');
    await (await page.$$('.gv-save'))[0].click();
    await page.waitForFunction(() => window.__clicks.length === 1);
    assert.deepEqual(await page.evaluate(() => [window.__clicks, window.__shared]), [[['life-centre-paynow-tithes-offering.png', 'blob:']], []]);
    await context.close();
  });
  it('Share opens the share sheet with the same full PNG, and does nothing more if it is cancelled', async () => {
    const { page, context } = await open('#/giving', { setup: async (p) => { await p.setUserAgent(ANDROID_UA); await qrStubs(p); } });
    await page.waitForSelector('.gv-share');
    const shares = await page.$$('.gv-share');
    assert.deepEqual(await page.$$eval('.gv-share', (els) => els.map((b) => [b.textContent.trim(), b.getAttribute('aria-label'), Math.round(b.getBoundingClientRect().height) >= 44, b.previousElementSibling?.className])),
      [['Share', 'Share the QR code for Life Centre (Tithes, Offering)', true, 'gv-save'], ['Share', 'Share the QR code for Life Centre (Building Fund)', true, 'gv-save']], 'a Share button beside each Save QR code');
    assert.ok(await page.$$eval('.gv-share', (els) => els.every((b) => b.getBoundingClientRect().width < b.previousElementSibling.getBoundingClientRect().width)), 'Share is the smaller button');
    await shares[1].click();
    await page.waitForFunction(() => window.__shared.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__shared), [[['life-centre-paynow-building-fund.png', 'image/png', PNG_SIZE.building]]]);
    await shares[0].click();
    await page.waitForFunction(() => window.__shared.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__shared[1]), [['life-centre-paynow-tithes-offering.png', 'image/png', PNG_SIZE.tithes]]);
    await page.evaluate(() => { window.__cancel = true; });
    await shares[0].click();
    await page.waitForFunction(() => window.__shared.length === 3);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await page.evaluate(() => window.__clicks), [], 'no download from Share');
    assert.deepEqual([await text(page, '[role=status]'), ...(await notes(page))], ['', '', ''], 'nothing is said when the share sheet is cancelled');
    await context.close();
  });
  it('on an iPhone, Save QR code uses the share sheet, which is where Save Image lives', async () => {
    const { page, context } = await open('#/giving', { setup: async (p) => { await p.setUserAgent(IPHONE_UA); await qrStubs(p); } });
    await page.waitForSelector('.gv-save');
    await (await page.$$('.gv-save'))[1].click();
    await page.waitForFunction(() => window.__shared.length === 1);
    assert.deepEqual(await page.evaluate(() => [window.__shared, window.__clicks]), [[[['life-centre-paynow-building-fund.png', 'image/png', PNG_SIZE.building]]], []]);
    assert.deepEqual(await notes(page), ['', ''], 'no download note after a share');
    await context.close();
  });
  it('on an iPhone that cannot share files, Save QR code falls back to the download', async () => {
    const { page, context } = await open('#/giving', {
      setup: async (p) => {
        await p.setUserAgent(IPHONE_UA);
        await p.evaluateOnNewDocument(() => {
          window.__clicks = [];
          navigator.canShare = undefined;
          HTMLAnchorElement.prototype.click = function () { window.__clicks.push([this.download, this.href.slice(0, 5)]); };
        });
      },
    });
    await page.waitForSelector('.gv-save');
    await (await page.$$('.gv-save'))[0].click();
    await page.waitForFunction(() => window.__clicks.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__clicks), [['life-centre-paynow-tithes-offering.png', 'blob:']]);
    assert.deepEqual(await notes(page), ['Saved to your Downloads', '']);
    await context.close();
  });
  it('has two sections, closed at first, that open and close from their headings', async () => {
    const { page, context } = await open('#/giving');
    const state = () => page.$$eval('.gv-acc', (els) => els.map((e) => {
      const button = e.querySelector('h2 > button');
      const panel = e.querySelector('.gv-acc-panel');
      return [button.textContent.trim(), button.getAttribute('aria-expanded'), panel.hidden, button.getAttribute('aria-controls') === panel.id];
    }));
    assert.deepEqual(await state(), [['Giving via Internet bank transfer', 'false', true, true], ['Giving via Cash/Cheque', 'false', true, true]]);
    assert.ok(await page.evaluate(() => document.querySelector('.gv-acc').getBoundingClientRect().top > document.querySelector('.gv-fund:last-of-type').getBoundingClientRect().bottom - 1), 'the sections come after the QR cards');
    await page.click('#gv-bank-btn');
    assert.deepEqual(await state(), [['Giving via Internet bank transfer', 'true', false, true], ['Giving via Cash/Cheque', 'false', true, true]]);
    assert.ok(await page.$eval('#gv-bank-panel', (e) => e.getBoundingClientRect().height > 100), 'the open section is visible');
    assert.match(await text(page, '#gv-bank-panel'), /If you have an online banking facility, you may give your tithes and offerings & Building Fund Contributions via Internet bank transfer\./);
    await page.click('#gv-cash-btn');
    assert.deepEqual((await state()).map((s) => s[1]), ['true', 'true']);
    await page.click('#gv-bank-btn');
    await page.click('#gv-cash-btn');
    assert.deepEqual(await state(), [['Giving via Internet bank transfer', 'false', true, true], ['Giving via Cash/Cheque', 'false', true, true]]);
    await context.close();
  });
  it('shows the bank account numbers exactly, and each Copy button copies its number', async () => {
    const { page, context } = await open('#/giving');
    await page.click('#gv-bank-btn');
    assert.deepEqual(await page.$$eval('.gv-bank-fund', (els) => els.map((e) => [e.querySelector('.gv-bank-title').textContent, e.querySelector('.gv-uen').textContent, e.querySelector('.gv-copy').getAttribute('aria-label')])), [
      ['LIFE CENTRE (TITHES & OFFERING)', '669417388001', 'Copy the account number for LIFE CENTRE (TITHES & OFFERING)'],
      ['LIFE CENTRE (BUILDING FUND)', '669417396001', 'Copy the account number for LIFE CENTRE (BUILDING FUND)'],
    ]);
    const panel = await text(page, '#gv-bank-panel');
    assert.equal(panel.split('Oversea-Chinese Banking Corporation Limited (OCBC)').length - 1, 2);
    assert.equal(panel.split('Recipient/Payee name - LIFE CENTRE').length - 1, 2);
    assert.match(panel, /Add LIFE CENTRE as a funds transfer payee with the following bank account details:/);
    const copies = await page.$$('#gv-bank-panel .gv-copy');
    await copies[1].click();
    await page.waitForFunction(() => document.querySelectorAll('#gv-bank-panel .gv-copy')[1].textContent.trim() === 'Copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '669417396001');
    assert.match(await text(page, '[role=status]'), /LIFE CENTRE \(BUILDING FUND\) account number copied/);
    assert.equal(await page.$eval('#gv-bank-panel .gv-copy', (b) => b.textContent.trim()), 'Copy', 'the other number is unchanged');
    await copies[0].click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '669417388001');
    await context.close();
  });
  it('keeps the cheque wording and the three-line address, and its PayNow and bank transfer links work', async () => {
    const { page, context } = await open('#/giving');
    await page.click('#gv-cash-btn');
    assert.deepEqual(await page.$$eval('.gv-address > *', (els) => els.map((e) => e.textContent)), ['Life Centre (Attn: Finance)', '3 Yishun Street 11, #01-01', 'Singapore 768645']);
    const panel = await text(page, '#gv-cash-panel');
    assert.match(panel, /^You may drop your cash\/cheque at our offering boxes available at any of our Locations during Sunday services, or mail your cheque to us at:/);
    assert.match(panel, /\*Important: Please make cheque payable to LIFE CENTRE and write your contact number on the reverse\. Please do not mail cash\. Do also note that there is a \$0\.75 admin fee charged by the bank for each cheque processed from 1 August 2022\./);
    assert.match(panel, /You may wish to consider giving via PayNow or Internet bank transfer instead\./);
    assert.equal(await page.$eval('#gv-cash-panel b', (b) => b.textContent), 'LIFE CENTRE');
    assert.equal(await page.$eval('#gv-cash-panel h3', (e) => e.textContent), 'Designated Offering');
    assert.equal((await page.$$('#gv-cash-panel li')).length, 2);
    // PayNow takes the reader up to the QR codes.
    await page.$eval('#gv-cash-panel button.gv-inline', (b) => b.scrollIntoView({ block: 'center' })); // clear of the bottom bar
    await page.click('#gv-cash-panel button.gv-inline::-p-text(PayNow)');
    await page.waitForFunction(() => { const top = document.querySelector('.gv-fund').getBoundingClientRect().top; return top > -4 && top < 120; }, { timeout: 5000 });
    // Internet bank transfer opens the bank transfer section.
    assert.equal(await page.$eval('#gv-bank-btn', (b) => b.getAttribute('aria-expanded')), 'false');
    await page.$eval('#gv-cash-panel button.gv-inline:last-of-type', (b) => b.scrollIntoView({ block: 'center' }));
    await page.click('#gv-cash-panel button.gv-inline::-p-text(Internet bank transfer)');
    assert.equal(await page.$eval('#gv-bank-btn', (b) => b.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gv-bank-btn');
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
  const openWatch = async (hash, options) => { const opened = await open(hash, options); await opened.page.waitForSelector('.wt-slide'); return opened; };
  const resumeAt = (id, t) => (page) => page.evaluateOnNewDocument((state) => localStorage.setItem('lc:v1:watchResume', JSON.stringify(state)), { id, t });
  const current = (page) => page.$eval('.wt-title', (e) => e.textContent);
  const waitCurrent = (page, title) => page.waitForFunction((t) => document.querySelector('.wt-title')?.textContent === t, { timeout: 8000 }, title);
  const progress = (page) => page.$eval('.wt-bar', (e) => Number(e.getAttribute('aria-valuenow')));
  // the feed has come to rest exactly on video number `index` (counting from 0)
  const waitRestedOn = (page, index) => page.waitForFunction((i) => { const f = document.querySelector('.wt-feed'); return Math.abs(f.scrollTop / f.clientHeight - i) < 0.02; }, { timeout: 8000 }, index);

  it('opens on the first sample video with the Sample label, a progress line and the tab bar', async () => {
    const { page, errors, context } = await openWatch('#/watch');
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
    const { page, context } = await openWatch('#/watch');
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
    const { page, context } = await openWatch('#/watch');
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
    const { page, context } = await openWatch('#/watch');
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
    const { page, context } = await openWatch('#/watch', { setup: resumeAt('sample-v3', 20) });
    await page.waitForFunction(() => document.querySelector('.wt-toast.on'), { timeout: 4000 });
    assert.equal(await text(page, '.wt-toast'), 'Continue where you left off · 0:20');
    await waitCurrent(page, 'Testimony: an answered prayer');
    assert.ok(await progress(page) >= 20);
    await shot(page, 'watch-resume');
    await page.waitForFunction(() => !document.querySelector('.wt-toast.on'), { timeout: 6000 });
    // leaving and coming back keeps the place
    await goto(page, '/giving');
    await goto(page, '/watch');
    await waitCurrent(page, 'Testimony: an answered prayer');
    await context.close();
  });
  it('does not offer to continue when the saved place is the very start, or when the video is unknown', async () => {
    for (const setup of [resumeAt('sample-v2', 1), resumeAt('gone', 30)]) {
      const { page, context } = await openWatch('#/watch', { setup });
      assert.equal(await page.$('.wt-toast.on'), null);
      await context.close();
    }
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await openWatch('#/watch');
    await checkAccessibility(page, 'Watch');
    await context.close();
  });
});

describe('Watch with posted videos and the publisher', () => {
  const idOf = (n) => `vid${String(n).padStart(8, '0')}`; // 11 characters
  const seedVideos = () => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { src: 'youtube', updatedBy: LEADER };
    await setDoc(doc(db, 'videos', 'v-old'), { ...base, title: 'Older message', org: 'Kids', videoId: idOf(1), url: `https://www.youtube.com/watch?v=${idOf(1)}`, createdAt: Timestamp.fromMillis(Date.now() - 86400000) });
    await setDoc(doc(db, 'videos', 'v-new'), { ...base, title: 'Newest message', desc: 'Fresh this week.', org: 'Yishun', videoId: idOf(2), url: `https://www.youtube.com/watch?v=${idOf(2)}`, createdAt: Timestamp.fromMillis(Date.now() - 3600000) });
  });
  // A stand-in for YouTube's player: it records what the app asks of it and counts seconds while "playing".
  const fakeYouTube = (page) => page.evaluateOnNewDocument(() => {
    window.__yt = { players: [] };
    window.YT = { Player: class {
      constructor(el, opts) {
        Object.assign(this, { opts, t: 0, d: 120, paused: false, muted: Boolean(opts.playerVars.mute), destroyed: false });
        window.__yt.players.push(this);
        this.f = document.createElement('iframe'); this.f.src = 'about:blank'; this.f.title = 'Video player';
        el.replaceWith(this.f);
        setTimeout(() => opts.events.onReady(), 20);
      }
      getCurrentTime() { return this.t; } getDuration() { return this.d; }
      playVideo() { this.paused = false; } pauseVideo() { this.paused = true; }
      mute() { this.muted = true; } unMute() { this.muted = false; }
      seekTo(s) { this.t = s; } destroy() { this.destroyed = true; this.f.remove(); }
    } };
    setInterval(() => { for (const p of window.__yt.players) if (!p.destroyed && !p.paused) p.t += 1; }, 1000);
  });
  const live = (page) => page.evaluate(() => window.__yt.players.filter((p) => !p.destroyed).map((p) => ({ id: p.opts.videoId, paused: p.paused, muted: p.muted, t: p.t, vars: p.opts.playerVars })));
  const watch = async (opts = {}) => {
    await seedVideos();
    const o = await open('#/watch', { ...opts, setup: async (page) => { await fakeYouTube(page); await opts.setup?.(page); } });
    await o.page.waitForSelector('.wt-slide');
    return o;
  };
  const title = (page) => page.$eval('.wt-title', (e) => e.textContent);
  const waitTitle2 = (page, t) => page.waitForFunction((x) => document.querySelector('.wt-title')?.textContent === x, { timeout: 8000 }, t);
  const staffWatch = async (email) => {
    await seedVideos();
    const o = await open('#/staff', { setup: fakeYouTube });
    await waitText(o.page, 'Sign in with Google');
    await signIn(o.page, email);
    await goto(o.page, '/watch');
    await o.page.waitForSelector('.wt-slide');
    return o;
  };
  const storedVideos = async () => {
    let list = [];
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { getDocs, collection } = await import('firebase/firestore');
      list = (await getDocs(collection(ctx.firestore(), 'videos'))).docs.map((d) => ({ id: d.id, ...d.data() }));
    });
    return list;
  };

  it('shows the posted videos newest first, with no Sample label, and plays only the one on screen', async () => {
    const { page, errors, context } = await watch();
    assert.equal((await page.$$('.wt-slide')).length, 2);
    assert.equal(await title(page), 'Newest message');
    assert.equal(await text(page, '.wt-chip'), 'YouTube');
    assert.equal(await text(page, '.wt-name'), 'Yishun');
    assert.equal(await text(page, '.wt-desc'), 'Fresh this week.');
    assert.equal(await text(page, '.wt-caption'), '');
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Sample/);
    await page.waitForFunction(() => window.__yt.players.some((p) => !p.destroyed));
    const players = await live(page);
    assert.equal(players.length, 1, 'one player at a time');
    assert.equal(players[0].id, idOf(2));
    assert.equal(players[0].muted, true, 'starts muted, so the browser lets it autoplay');
    assert.equal(players[0].vars.controls, 0);
    assert.equal(await page.$eval('.wt-slide iframe', (f) => getComputedStyle(f).pointerEvents), 'none', 'taps and drags reach the feed');
    await shot(page, 'watch-youtube');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('draws the progress line from the YouTube player and keeps pause and sound working', async () => {
    const { page, context } = await watch();
    await page.waitForFunction(() => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) >= 2, { timeout: 8000 });
    assert.match(await page.$eval('.wt-bar', (e) => e.getAttribute('aria-valuetext')), /^0:0[2-9] of 2:00$/);
    await page.mouse.click(195, 400);
    await page.waitForSelector('.wt-pause.on');
    assert.equal((await live(page))[0].paused, true, 'tap pauses the video');
    await page.mouse.click(195, 400);
    await page.waitForFunction(() => !document.querySelector('.wt-pause.on') && !window.__yt.players.find((p) => !p.destroyed).paused);
    await page.click('.wt-sound');
    assert.equal((await live(page))[0].muted, false, 'sound on');
    await page.click('.wt-sound');
    assert.equal((await live(page))[0].muted, true, 'sound off');
    await context.close();
  });

  it('moves to the next video with a new player, from the beginning, and the old player is gone', async () => {
    const { page, context } = await watch();
    await page.waitForFunction(() => Number(document.querySelector('.wt-bar').getAttribute('aria-valuenow')) >= 2, { timeout: 8000 });
    await page.focus('.wt-feed');
    await page.keyboard.press('ArrowDown');
    await waitTitle2(page, 'Older message');
    await page.waitForFunction((id) => window.__yt.players.some((p) => !p.destroyed && p.opts.videoId === id), { timeout: 5000 }, idOf(1));
    const players = await live(page);
    assert.deepEqual(players.map((p) => p.id), [idOf(1)]);
    assert.ok(players[0].t <= 1);
    assert.equal(await text(page, '.wt-name'), 'Kids');
    assert.equal(await page.$('.wt-desc:not([hidden])'), null, 'no description line when there is none');
    await context.close();
  });

  it('says "Continue where you left off" and seeks the YouTube video to the saved second', async () => {
    const { page, context } = await watch({ setup: (p) => p.evaluateOnNewDocument(() => localStorage.setItem('lc:v1:watchResume', JSON.stringify({ id: 'v-old', t: 30 }))) });
    await page.waitForFunction(() => document.querySelector('.wt-toast.on'), { timeout: 4000 });
    assert.equal(await text(page, '.wt-toast'), 'Continue where you left off · 0:30');
    await waitTitle2(page, 'Older message');
    await page.waitForFunction(() => window.__yt.players.some((p) => !p.destroyed && p.opts.videoId === 'vid00000001' && p.t >= 30), { timeout: 6000 });
    await shot(page, 'watch-youtube-resume');
    await context.close();
  });

  it('shows a message and a link when the video cannot load', async () => {
    await seedVideos();
    const { page, context } = await open('#/watch', { setup: async (p) => {
      await p.setRequestInterception(true);
      p.on('request', (r) => (/youtube\.com|ytimg\.com/.test(r.url()) ? r.abort() : r.continue()));
    } });
    await page.waitForSelector('.wt-fail', { timeout: 10000 });
    assert.match(await text(page, '.wt-fail'), /could not be loaded/);
    assert.equal(await page.$eval('.wt-fail-link', (a) => a.href), `https://www.youtube.com/watch?v=${idOf(2)}`);
    await context.close();
  });

  it('shows the + button to admins and leaders only', async () => {
    for (const [email, shown] of [[ADMIN, true], [LEADER, true], [STAFF, false]]) {
      const { page, context } = await staffWatch(email);
      assert.equal(await page.$eval('.wt-add', (b) => !b.hidden), shown, email);
      await context.close();
    }
    const { page, context } = await watch();
    assert.equal(await page.$eval('.wt-add', (b) => b.hidden), true, 'signed out');
    await context.close();
  });

  it('adds a video: checks the title and link, stores the video id and organization, and shows it first', async () => {
    const { page, errors, context } = await staffWatch(LEADER);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'staff', LEADER), { role: 'leader', name: 'Kids Ministry', updatedBy: ADMIN }));
    await page.click('.wt-add');
    await page.waitForSelector('.wt-sheet[role=dialog]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'wt-f-title', 'focus starts in the title');
    assert.equal((await live(page))[0].paused, true, 'the video pauses behind the sheet');
    await shot(page, 'watch-publisher');
    await page.click('.wt-publish');
    await waitText(page, 'Please give the video a title.', '.wt-error');
    await page.type('#wt-f-title', '  Kids camp  ');
    await page.type('#wt-f-link', 'https://vimeo.com/123456');
    await page.click('.wt-publish');
    await waitText(page, 'Please paste a YouTube or YouTube Shorts link.', '.wt-error');
    await page.$eval('#wt-f-link', (i) => { i.value = ''; });
    await page.type('#wt-f-link', 'https://www.youtube.com/shorts/aBcDeFgHiJk?feature=share');
    await page.click('.wt-publish');
    await page.waitForFunction(() => !document.querySelector('.wt-sheet'), { timeout: 8000 });
    await waitTitle2(page, 'Kids camp');
    assert.equal((await page.$$('.wt-slide')).length, 3);
    assert.equal(await text(page, '.wt-name'), 'Kids Ministry');
    await page.waitForFunction(() => window.__yt.players.some((p) => !p.destroyed && p.opts.videoId === 'aBcDeFgHiJk'));
    const saved = (await storedVideos()).find((d) => d.title === 'Kids camp');
    assert.equal(saved.videoId, 'aBcDeFgHiJk');
    assert.equal(saved.url, 'https://www.youtube.com/watch?v=aBcDeFgHiJk');
    assert.equal(saved.src, 'youtube');
    assert.equal(saved.org, 'Kids Ministry');
    assert.equal(saved.updatedBy, LEADER);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('closes the sheet with Escape or the close button and carries on playing, with nothing posted', async () => {
    const { page, context } = await staffWatch(ADMIN);
    await page.click('.wt-add');
    await page.waitForSelector('.wt-sheet');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.wt-sheet'));
    await page.waitForFunction(() => !window.__yt.players.find((p) => !p.destroyed)?.paused);
    await page.click('.wt-add');
    await page.click('.wt-sheet-x');
    await page.waitForFunction(() => !document.querySelector('.wt-sheet'));
    assert.equal((await page.$$('.wt-slide')).length, 2);
    assert.equal((await storedVideos()).length, 2);
    await context.close();
  });

  it('lets staff remove a video, but not a sample, and the public never sees the button', async () => {
    const { page, context } = await staffWatch(STAFF);
    assert.equal(await page.$eval('.wt-remove', (b) => !b.hidden), true);
    await page.click('.wt-remove'); // the test browser accepts the confirmation
    await waitTitle2(page, 'Older message');
    assert.equal((await page.$$('.wt-slide')).length, 1);
    assert.deepEqual((await storedVideos()).map((v) => v.id), ['v-old']);
    await page.click('.wt-remove');
    await page.waitForFunction(() => document.querySelector('.wt-chip')?.textContent === 'Sample', { timeout: 8000 });
    assert.equal(await page.$eval('.wt-remove', (b) => b.hidden), true, 'a sample card cannot be removed');
    await context.close();
    const anon = await watch();
    assert.equal(await anon.page.$eval('.wt-remove', (b) => b.hidden), true);
    await anon.context.close();
  });

  it('has no accessibility violations with videos or with the sheet open', async () => {
    const { page, context } = await staffWatch(ADMIN);
    await checkAccessibility(page, 'Watch with videos');
    await page.click('.wt-add');
    await page.waitForSelector('.wt-sheet');
    await checkAccessibility(page, 'Add a video sheet');
    await context.close();
  });
});

// Real-phone readiness: every screen at a small phone, the design size and a large phone. Nothing may push the page sideways,
// and every button, link and field must be at least 44 x 44 px to tap (the bottom bar, headers and sheets included).
describe('Phone sizes: layout and tap targets', () => {
  const SIZES = [[375, 667], [390, 844], [430, 932]];
  const MIN = 44;
  const auditPage = (min) => {
    const vw = innerWidth;
    const problems = [];
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('.sr');
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const main = document.querySelector('#main');
    if (main && main.scrollWidth > main.clientWidth + 1) problems.push(`#main is wider than the screen (${main.scrollWidth} > ${main.clientWidth})`);
    const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'hidden' || o === 'clip') && p.getBoundingClientRect().right <= vw + 1) return true; } return false; };
    const scrollsSideways = (el) => { const o = getComputedStyle(el).overflowX; return (o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el !== main && el !== document.body; };
    for (const el of document.querySelectorAll('.app *')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !el.closest('.orb') && !clipped(el) && ![...(function* () { for (let p = el.parentElement; p; p = p.parentElement) yield p; }())].some(scrollsSideways)) problems.push(`sticks out of the screen: ${name(el)} (${Math.round(r.left)} to ${Math.round(r.right)})`);
    }
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]')) {
      if (!shown(el)) continue;
      const box = el.matches('input[type=checkbox], input[type=radio]') ? (el.closest('label') ?? el.labels?.[0] ?? el) : el;
      // The Home calendar is a time grid: its tiles can be 15 minutes tall by design, and each one is also a row in the Day plan.
      if (el.matches('.cell .tile')) continue;
      const r = box.getBoundingClientRect();
      if (r.width < min - 0.5 || r.height < min - 0.5) problems.push(`small tap target: ${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return [...new Set(problems)];
  };
  const SCREENS = [
    ['Home', '#/'], ['Events', '#/events'], ['an event', '#/events/conf'], ['a location', '#/events/location/yishun'], ['Notifications', '#/notifications'],
    ['Day plan', '#/day'], ['Giving', '#/giving'], ['Watch', '#/watch'], ['Contact us', '#/contact'], ['Sign-in, arriving from booking', '#/booking'],
  ];
  const STAFF_SCREENS = [['Staff page', '/staff'], ['Create event', '/events/new'], ['Edit event', '/events/e1/edit'], ['Events (staff)', '/events']];

  for (const [width, height] of SIZES) {
    it(`${width}x${height}: no screen breaks or has a small tap target`, async () => {
      const report = [];
      for (const [label, hash] of SCREENS) {
        const { page, context } = await open(hash, { width, height });
        await new Promise((r) => setTimeout(r, 900)); // let the screen finish loading
        if (hash === '#/contact') { await page.click('button.ct-row'); await new Promise((r) => setTimeout(r, 200)); }
        if (hash === '#/giving') { await page.click('#gv-bank-btn'); await page.click('#gv-cash-btn'); await new Promise((r) => setTimeout(r, 200)); }
        if (hash === '#/') await page.waitForSelector('.tile.card', { timeout: 15000 }).catch(() => {});
        for (const p of await page.evaluate(auditPage, MIN)) report.push(`${label}: ${p}`);
        await context.close();
      }
      for (const [label, path] of STAFF_SCREENS) {
        const { page, context } = await openAsStaff(path, ADMIN, { width, height });
        await new Promise((r) => setTimeout(r, 900));
        for (const p of await page.evaluate(auditPage, MIN)) report.push(`${label}: ${p}`);
        await context.close();
      }
      assert.deepEqual(report, []);
    });
  }
});

describe('Installable app and offline use', () => {
  it('serves the manifest and the icons, and a full load has no failed requests (no favicon 404)', async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto(base);
    await page.waitForSelector('#page-title');
    await new Promise((r) => setTimeout(r, 800));
    assert.deepEqual(failed, []);
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      const res = await fetch(link.href);
      return { type: res.headers.get('content-type'), json: await res.json(), base: link.href };
    });
    assert.match(manifest.type, /manifest\+json/);
    assert.equal(manifest.json.name, 'Life Centre');
    for (const icon of manifest.json.icons) {
      const status = await page.evaluate(async (u) => (await fetch(u)).status, new URL(icon.src, manifest.base).href);
      assert.equal(status, 200, icon.src);
    }
    assert.equal(await page.$eval('link[rel=icon]', (l) => l.sizes.value), '32x32');
    await context.close();
  });

  it('saves the app shell (never data) and opens with no connection', async () => {
    const own = await serve(0); // its own server, so it can be switched off to go truly offline
    const url = `http://localhost:${own.address().port}/app/?emulator&sw`;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${url}#/giving`);
    await page.waitForSelector('#page-title');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the worker
    await page.waitForSelector('#page-title');
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
    const saved = await page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
      return out;
    });
    for (const file of ['/app/index.html', '/app/js/main.js', '/app/js/views/watch.js', '/app/js/views/booking.js', '/app/css/screens.css', '/app/manifest.webmanifest', '/app/icons/icon-512.png']) {
      assert.ok(saved.some((u) => u.endsWith(file)), `${file} is saved`);
    }
    assert.ok(saved.some((u) => /gstatic\.com\/firebasejs\/.*firebase-firestore\.js$/.test(u)), 'the Firebase code is saved');
    assert.deepEqual(saved.filter((u) => /firestore\.googleapis|127\.0\.0\.1|identitytoolkit|script\.google|youtube\.com|youtube-nocookie|ytimg/.test(u)), [], 'no data or sign-in or booking requests are saved');
    // a file that changed on the server must never be served from the browser's own copy beside newer ones: the worker asks the server every time
    const asked = [];
    own.on('request', (req) => asked.push([req.url, req.headers['cache-control'], req.headers['if-none-match'] || req.headers['if-modified-since']]));
    await page.evaluate(() => fetch('/app/js/data.js').then((r) => r.text()));
    const data = asked.filter(([u]) => u.endsWith('/app/js/data.js'));
    assert.ok(data.length > 0 && data.every(([, cc, cond]) => /max-age=0|no-cache/.test(cc || '') || cond), `data.js is revalidated, not taken from the browser's copy (${JSON.stringify(data)})`);
    own.closeAllConnections(); own.close(); // the network is gone for this app
    await page.reload();
    await page.waitForSelector('#page-title', { timeout: 15000 });
    assert.equal(await pageTitle(page), 'Giving via PayNow');
    await goto(page, '/contact');
    assert.equal(await pageTitle(page), 'Contact us');
    await goto(page, '/');
    assert.match(await pageTitle(page), /^Good (morning|afternoon|evening)/);
    await goto(page, '/watch');
    await page.waitForSelector('.wt-slide', { timeout: 15000 });
    assert.deepEqual(errors, []);
    await context.close();
  });
});

// An accessibility sweep over the states the screen-by-screen checks above do not reach: open menus and sheets, every staff tab,
// each role, and the small phone. (axe checks contrast, names, roles, landmarks, focus order hints and target size.)
describe('Accessibility sweep: menus, sheets, roles and the small phone', () => {
  const ready = (page) => new Promise((r) => setTimeout(r, 700)).then(() => page.waitForSelector('#page-title'));
  const eventPage = async (page) => { await page.waitForSelector('.act'); await new Promise((r) => setTimeout(r, 1200)); await page.$eval('.act', (a) => a.scrollIntoView({ block: 'center' })); }; // the page redraws once the live data arrives
  const SIGNED_OUT = [
    ['Home: + menu open', '#/', async (page) => { await page.waitForSelector('.tile.card'); await page.$eval('.fab', (b) => b.scrollIntoView({ block: 'center' })); await page.click('.fab'); }],
    ['Home: month list open', '#/', async (page) => { await page.waitForSelector('.tile.card'); await page.$eval('.month-btn', (b) => b.scrollIntoView({ block: 'center' })); await page.click('.month-btn'); }],
    ['Account: signed out', '#/account', async (page) => { await page.waitForSelector('#bk-email'); }],
    ['Events: location menu open', '#/events', async (page) => { await page.waitForSelector('.ev-row'); await page.click('.pill-btn'); }],
    ['Event page: More menu', '#/events/conf', async (page) => { await eventPage(page); await page.click('.act[aria-haspopup=menu]'); }],
    ['Event page: Contact sheet', '#/events/conf', async (page) => { await eventPage(page); await page.click('.act::-p-text(Contact)'); await page.waitForSelector('.sheet'); }],
    ['Event page: calendar sheet', '#/events/conf', async (page) => { await eventPage(page); await page.click('.act[aria-haspopup=menu]'); await page.click('[role=menuitem]::-p-text(Add to calendar)'); await page.waitForSelector('.sheet'); }],
    ['Event page: QR sheet', '#/events/conf', async (page) => { await eventPage(page); await page.click('.act[aria-haspopup=menu]'); await page.click('[role=menuitem]::-p-text(Event QR code)'); await page.waitForSelector('.sheet'); }],
    ['Location: a filter chosen', '#/events/location/yishun', async (page) => { await page.click('button.chip::-p-text(Services)'); }],
    ['Contact: Plan a visit open', '#/contact', async (page) => { await page.click('button.ct-row'); }],
    ['Giving: both sections open', '#/giving', async (page) => { await page.click('#gv-bank-btn'); await page.click('#gv-cash-btn'); }],
    ['Giving: after Copy', '#/giving', async (page) => { await page.click('.gv-copy'); await page.waitForFunction(() => document.querySelector('.gv-copy').textContent.trim() === 'Copied'); }],
    ['Watch: paused', '#/watch', async (page) => { await page.waitForSelector('.wt-slide'); await page.mouse.click(195, 400); await page.waitForSelector('.wt-pause.on'); }],
    ['Watch: Continue where you left off', '#/watch', async (page) => { await page.waitForSelector('.wt-slide'); }],
  ];
  for (const [width, height] of [[390, 844], [375, 667]]) {
    for (const [label, hash, step] of SIGNED_OUT) {
      it(`${label} (${width}x${height})`, async () => {
        const { page, context } = await open(hash, { width, height, setup: label.includes('Continue') ? (p) => p.evaluateOnNewDocument(() => localStorage.setItem('lc:v1:watchResume', JSON.stringify({ id: 'sample-v3', t: 20 }))) : undefined });
        await ready(page);
        await step(page);
        await new Promise((r) => setTimeout(r, 400));
        await checkAccessibility(page, label);
        await context.close();
      });
    }
  }

  const STAFF_STATES = [
    ['Staff page: Notices (staff)', STAFF, '/staff', async () => {}],
    ['Staff page: Verses', STAFF, '/staff', async (page) => { await page.click('.switch button::-p-text(Verses)'); }],
    ['Staff page: Events', STAFF, '/staff', async (page) => { await page.click('.switch button::-p-text(Events)'); }],
    ['Staff page: Staff list (admin)', ADMIN, '/staff', async (page) => { await page.click('.switch button::-p-text(Staff)'); }],
    ['Events as admin', ADMIN, '/events', async (page) => { await page.waitForSelector('.ev-row'); }],
    ['Event page as admin (Edit in More)', ADMIN, '/events/conf', async (page) => { await eventPage(page); await page.click('.act[aria-haspopup=menu]'); }],
    ['Home as staff (Facilities tab)', STAFF, '/', async (page) => { await page.waitForSelector('.tile.card'); }],
    ['Watch as leader (+ and trash buttons)', LEADER, '/watch', async (page) => { await page.waitForSelector('.wt-add:not([hidden])'); }],
    ['Watch: Add a video, with an error', LEADER, '/watch', async (page) => { await page.click('.wt-add'); await page.click('.wt-publish'); await page.waitForFunction(() => document.querySelector('.wt-error').textContent); }],
    ['Create event: cover colours and a photo choice', ADMIN, '/events/new', async (page) => { await page.click('.cr-fab.left'); }],
  ];
  for (const [label, email, path, step] of STAFF_STATES) {
    it(`${label}`, async () => {
      const { page, context } = await openAsStaff(path, email);
      await ready(page);
      await step(page);
      await new Promise((r) => setTimeout(r, 500));
      await checkAccessibility(page, label);
      await context.close();
    });
  }
});

// ---- Verse of the day in Bible versions ----

const NIV_NOTICE = 'Scripture quotations taken from The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide. NIV is a registered trademark of Biblica, Inc.';
const NASB_NOTICE = 'Scripture quotations from the New American Standard Bible – NASB 2020 Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. All rights reserved. Used by permission.';
const votdEntry = (abbr, name, language, text, extra = {}) => ({ abbr, name, language, reference: 'John 3:16', text, footnotes: [], notice: '', publisher: '', link: '', ...extra });
const VOTD_VERSIONS = {
  111: votdEntry('NIV', 'New International Version', 'eng', 'For God so loved the world that he gave his one and only Son.', { notice: NIV_NOTICE, publisher: 'Biblica', link: 'https://www.biblica.com', footnotes: ['Or *his only begotten Son*'] }),
  2692: votdEntry('NASB 2020', 'New American Standard Bible 2020', 'eng', 'For God so loved the world, that He gave His only Son.', { notice: NASB_NOTICE, publisher: 'The Lockman Foundation', link: 'https://www.lockman.org' }),
  206: votdEntry('WEB', 'World English Bible', 'eng', 'For God so loved the world, that he gave his only born Son.', { publisher: 'worldenglishbible.org', link: 'https://worldenglishbible.org' }),
  2730: votdEntry('TCV', 'Tamil Contemporary Version', 'tam', 'தேவன் உலகத்தின்மீது அன்பாயிருந்தார்.', { reference: 'யோவான் 3:16', notice: 'Tamil notice © Biblica, Inc. TCV is a trademark of Biblica, Inc.', publisher: 'Biblica', link: 'https://www.biblica.com' }),
  1392: votdEntry('CCBT', 'Chinese Contemporary Bible (Traditional)', 'zho', '神愛世人，甚至將他的獨生子賜給他們。', { reference: '約翰福音 3:16', notice: 'Chinese notice © Biblica, Inc.', publisher: 'Biblica', link: 'https://www.biblica.com' }),
};
// A document as saved in the emulator (withSecurityRulesDisabled does not hand back what its callback returns).
function dayLabel(key) { // '2026-11-01' -> 'Sun 1 Nov 2026', as the staff list shows it
  const d = new Date(`${key}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
async function readDoc(col, id) {
  let snap;
  await env.withSecurityRulesDisabled(async (ctx) => { snap = await getDoc(doc(ctx.firestore(), col, id)); });
  return snap.exists() ? snap.data() : undefined;
}
async function seedVotd(versions = VOTD_VERSIONS, date = TODAY) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'votd', date), { date, passageId: 'JHN.3.16', source: 'staff', versions });
  });
}
const verseCard = (page) => page.$eval('.verse-card', (c) => ({
  chip: c.querySelector('.verse-chip .chip').textContent.trim(),
  text: c.querySelector('blockquote').textContent,
  reference: c.querySelector('cite').textContent,
  notice: c.querySelector('.verse-notice')?.textContent ?? '',
  link: c.querySelector('.verse-notice a') ? [c.querySelector('.verse-notice a').textContent, c.querySelector('.verse-notice a').href] : null,
  notes: [...c.querySelectorAll('.verse-notes li')].map((li) => li.textContent),
}));
const waitVerse = (page, chip) => page.waitForFunction((x) => document.querySelector('.verse-card .verse-chip .chip')?.textContent.trim() === x, { timeout: 15000 }, chip);

describe('the verse of the day in Bible versions', () => {
  it('shows NIV at first: the text as supplied, the reference once, the notice with its Biblica link, and the footnotes', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    assert.deepEqual(await verseCard(page), {
      chip: 'NIV', text: 'For God so loved the world that he gave his one and only Son.', reference: 'John 3:16',
      notice: `${NIV_NOTICE} Biblica`, link: ['Biblica', 'https://www.biblica.com/'], notes: ['Or *his only begotten Son*'],
    });
    assert.equal((await text(page, '.verse-card')).match(/John 3:16/g).length, 1, 'the reference appears once');
    assert.doesNotMatch(await text(page, '.verse-card'), /·/, 'no "reference · translation" line');
    assert.equal(await page.$('.verse-card .badge'), null);
    const chip = await (await page.$('.verse-chip')).boundingBox();
    assert.ok(chip.height >= 44, `the chip is ${chip.height}px tall`);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerHTML), /youversion/i);
    await context.close();
  });

  const openSheet = async (page) => { await page.click('.verse-chip'); await page.waitForSelector('#vs-search'); };
  const resultsOf = (page) => page.$$eval('.vs-item', (els) => els.map((e) => [e.dataset.version, e.querySelector('b').textContent, e.querySelector('small').textContent, e.getAttribute('aria-current') === 'true']));
  const typeQuery = async (page, q) => { await page.$eval('#vs-search', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); }); if (q) await page.type('#vs-search', q); await page.waitForFunction((n) => document.querySelector('#vs-search').value === n, {}, q); };
  const pickVersion = async (page, query, id) => { await openSheet(page); await typeQuery(page, query); await page.click(`.vs-item[data-version="${id}"]`); };
  const manyVotd = () => ({
    ...VOTD_VERSIONS,
    1895: votdEntry('IRV', 'Telugu Indian Revised Version', 'tel', 'తెలుగు పరీక్ష పాఠ్యం.', { reference: 'యోహాను 3:16' }),
    2431: votdEntry('MCV', 'Malayalam Contemporary Version', 'mal', 'മലയാളം പരീക്ഷണ വാചകം.', { reference: 'യോഹന്നാൻ 3:16', notice: 'Malayalam notice © Biblica, Inc.', publisher: 'Biblica', link: 'https://www.biblica.com' }),
    179: votdEntry('TNCV', 'Thai New Contemporary Version', 'tha', 'ข้อความทดสอบภาษาไทย', { reference: 'ยอห์น 3:16', notice: 'Thai notice © Biblica, Inc.', publisher: 'Biblica', link: 'https://www.biblica.com' }),
  });

  it('opens a small search sheet that shows three versions to a new member: NIV, Tamil and Chinese Simplified, with the current one marked', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await openSheet(page);
    assert.equal(await page.$eval('#vs-search', (i) => i.getAttribute('aria-label')), 'Search Bible versions');
    assert.deepEqual(await resultsOf(page), [
      ['111', 'NIV', 'New International Version · English', true],
      ['2730', 'TCV', 'Tamil Contemporary Version · Tamil', false],
      ['36', 'CCB', 'Chinese Contemporary Bible (Simplified) · Mandarin', false],
    ]);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'vs-search', 'the search box has focus');
    assert.equal(await page.$('.vs-group'), null, 'the full grouped list is gone');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:bible-recent')), null);
    await shot(page, 'sheet-new-member');
    await context.close();
  });

  it('swaps the verse at once when a version is picked, remembering it with no sign-in', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await openSheet(page);
    await page.click('.vs-item[data-version="2730"]');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    const card = await verseCard(page);
    assert.deepEqual([card.chip, card.text, card.reference], ['TCV', 'தேவன் உலகத்தின்மீது அன்பாயிருந்தார்.', 'யோவான் 3:16']);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'verse-chip', 'focus returns to the chip');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:bible-version')), '2730');
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:session')), null, 'no sign-in was needed');
    await page.reload();
    await waitVerse(page, 'TCV');
    await context.close();
  });

  it('shows the three most recently picked versions, newest first, then fills from the usual three without repeats', async () => {
    await seedVotd(manyVotd());
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await pickVersion(page, 'web', 206);
    await waitVerse(page, 'WEB');
    await openSheet(page);
    assert.deepEqual((await resultsOf(page)).map((r) => r[0]), ['206', '111', '2730'], 'one pick, then the usual three fill the rest');
    await page.keyboard.press('Escape');
    await pickVersion(page, 'nasb2020', 2692);
    await waitVerse(page, 'NASB 2020');
    await pickVersion(page, 'ccb', 1392);
    await waitVerse(page, 'CCBT');
    await pickVersion(page, 'niv', 111);
    await waitVerse(page, 'NIV');
    await openSheet(page);
    assert.deepEqual(await resultsOf(page), [
      ['111', 'NIV', 'New International Version · English', true],
      ['1392', 'CCBT', 'Chinese Contemporary Bible (Traditional) · Mandarin', false],
      ['2692', 'NASB 2020', 'New American Standard Bible 2020 · English', false],
    ]);
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:bible-recent')), '[111,1392,2692]', 'at most three, newest first');
    await typeQuery(page, 'web'); // the sheet is still open: picking one that is already in the list moves it to the front
    await page.click('.vs-item[data-version="206"]');
    await page.reload();
    await waitVerse(page, 'WEB');
    await openSheet(page);
    assert.deepEqual((await resultsOf(page)).map((r) => r[0]), ['206', '111', '1392']);
    await context.close();
  });

  it('finds versions as the member types: by abbreviation, full name, English language name and own-script name', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await openSheet(page);
    const ids = async (q) => { await typeQuery(page, q); return (await resultsOf(page)).map((r) => r[0]); };
    assert.deepEqual(await ids('nasb 2020'), ['2692'], 'abbreviation, spaces ignored');
    assert.deepEqual(await ids('NASB2020'), ['2692'], 'case ignored');
    assert.deepEqual(await ids('TCV'), ['2730']);
    assert.deepEqual(await ids('new american'), ['2692', '100'], 'full name, from the first letter');
    assert.deepEqual(await ids('Chinese Contemporary Bible Simplified'), ['36']);
    assert.deepEqual(await ids('tam'), ['2730', '1899'], 'language in English');
    assert.deepEqual(await ids('mandarin'), ['36', '1392', '43']);
    assert.deepEqual(await ids('chinese'), ['36', '1392', '43']);
    assert.deepEqual(await ids('telu'), ['1895']);
    assert.deepEqual(await ids('malay'), ['2431', '2333', '1912']);
    assert.deepEqual(await ids('thai'), ['179', '175']);
    assert.deepEqual(await ids('தமிழ்'), ['2730', '1899'], 'Tamil in its own script');
    assert.deepEqual(await ids('తెలుగు'), ['1895'], 'Telugu in its own script');
    assert.deepEqual(await ids('മലയാളം'), ['2431', '2333', '1912'], 'Malayalam in its own script');
    assert.deepEqual(await ids('ไทย'), ['179', '175'], 'Thai in its own script');
    assert.deepEqual(await ids('中文'), ['36', '1392', '43'], 'Chinese in its own script');
    assert.deepEqual(await ids('ew american'), [], 'matches from the first letter only');
    assert.deepEqual(await resultsOf(page), []);
    await typeQuery(page, 'tam');
    assert.deepEqual((await resultsOf(page))[0].slice(1, 3), ['TCV', 'Tamil Contemporary Version · Tamil'], 'abbreviation, full name and language');
    await shot(page, 'sheet-tam');
    await typeQuery(page, '中文');
    await shot(page, 'sheet-zhongwen');
    await typeQuery(page, '');
    assert.equal((await resultsOf(page)).length, 3, 'clearing the box shows the three again');
    await context.close();
  });

  it('shows at most six results, and says "No versions found" when nothing matches', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await openSheet(page);
    await typeQuery(page, 'e'); // English matches seven versions
    assert.deepEqual((await resultsOf(page)).map((r) => r[0]), ['111', '2692', '100', '1588', '3034', '206']);
    await typeQuery(page, 'zzz');
    assert.deepEqual(await resultsOf(page), []);
    assert.equal(await page.$eval('.vs-empty', (p) => [p.hidden, p.textContent]).then((r) => r.join('|')), 'false|No versions found');
    assert.equal(await text(page, '.version-sheet [role=status]'), 'No versions found', 'announced to screen readers');
    await typeQuery(page, 'tam');
    assert.equal(await text(page, '.version-sheet [role=status]'), '2 versions');
    assert.equal(await page.$eval('.vs-empty', (p) => p.hidden), true);
    await context.close();
  });

  it('works from the keyboard: arrows move through the results, Enter picks, Escape closes', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    await page.focus('.verse-chip');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#vs-search');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.version), '111');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.version), '36');
    await page.keyboard.press('ArrowDown'); // the last stays put
    assert.equal(await page.evaluate(() => document.activeElement.dataset.version), '36');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.version), '2730');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'vs-search', 'Up from the first goes back to the box');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal(await page.evaluate(() => document.activeElement.className), 'verse-chip');
    // type, move down, Enter
    await page.keyboard.press('Enter');
    await page.waitForSelector('#vs-search');
    await page.keyboard.type('chinese');
    await page.waitForFunction(() => document.querySelectorAll('.vs-item').length === 3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await waitVerse(page, 'CCBT');
    assert.equal((await verseCard(page)).reference, '約翰福音 3:16');
    // Enter in the box picks the first result
    await page.keyboard.press('Enter');
    await page.waitForSelector('#vs-search');
    await page.keyboard.type('nasb 1995');
    await page.waitForFunction(() => document.querySelectorAll('.vs-item').length === 1);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal(await page.evaluate(() => localStorage.getItem('lc:v1:bible-version')), '100');
    await context.close();
  });

  it('has a sheet that fits its content, never covers more than about half the screen, and passes the accessibility check', async () => {
    await seedVotd();
    for (const [width, height] of [[390, 844], [375, 667], [390, 500]]) {
      const { page, context } = await open('#/', { width, height });
      await waitVerse(page, 'NIV');
      await openSheet(page);
      const sheetHeight = () => page.$eval('.version-sheet .sheet', (s) => s.getBoundingClientRect().height);
      const three = await sheetHeight();
      assert.ok(three <= height * 0.55, `${width}x${height}: the sheet with three results is ${three}px`);
      await typeQuery(page, 'e');
      const six = await sheetHeight();
      assert.ok(six <= height * 0.55, `${width}x${height}: the sheet with six results is ${six}px`);
      assert.ok(six >= three, 'it grows with its content');
      await typeQuery(page, 'zzz');
      assert.ok(await sheetHeight() < three, 'and shrinks when there is nothing to show');
      assert.equal(await page.$$eval('.vs-item', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length), 0);
      assert.doesNotMatch(await text(page, '[role=dialog]'), /tap|swipe|click|drag|scroll|arrow|press/i, 'no how-to hint text');
      if (width === 390 && height === 844) {
        await checkAccessibility(page, 'Bible version sheet (three results)');
        await typeQuery(page, 'e');
        await checkAccessibility(page, 'Bible version sheet (six results)');
        await typeQuery(page, 'zzz');
        await checkAccessibility(page, 'Bible version sheet (no results)');
      }
      await context.close();
    }
  });

  it('scrolls the results with the mouse when they are taller than the sheet', async () => {
    await seedVotd();
    const { page, context } = await open('#/', { width: 390, height: 480 });
    await waitVerse(page, 'NIV');
    await openSheet(page);
    await typeQuery(page, 'e');
    assert.ok(await page.$eval('.vs-scroll', (l) => l.scrollHeight > l.clientHeight + 20), 'the six results are taller than the sheet');
    const box = await (await page.$('.vs-scroll')).boundingBox();
    await page.mouse.move(box.x + 200, box.y + box.height - 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 10, { steps: 8 });
    await page.mouse.up();
    assert.ok(await page.$eval('.vs-scroll', (l) => l.scrollTop) > 20, 'dragging with the mouse scrolls the results');
    await context.close();
  });

  it('sets Tamil, Telugu, Malayalam and Thai text at about 75 percent of the English size, and Chinese at the full size', async () => {
    await seedVotd(manyVotd());
    const sizeOf = async (id) => {
      const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument((v) => localStorage.setItem('lc:v1:bible-version', v), String(id)) });
      await page.waitForSelector('.verse-card blockquote');
      await page.waitForFunction((v) => document.querySelector('.verse-card blockquote').lang !== '' && !!document.querySelector('.verse-chip'), {}, id);
      const font = await page.$eval('.verse-card blockquote', (b) => parseFloat(getComputedStyle(b).fontSize));
      await context.close();
      return font;
    };
    const english = await sizeOf(206);
    assert.equal(english, 28);
    for (const id of [2730, 1895, 2431, 179]) {
      const font = await sizeOf(id);
      assert.ok(Math.abs(font / english - 0.75) < 0.03, `version ${id} is ${font}px`);
    }
    assert.equal(await sizeOf(1392), 28, 'Chinese keeps the current size');
  });

  it('shows only the version tag, as a link to Lockman, for NASB 2020, NASB 1995 and AMP on the card', async () => {
    await seedVotd({ ...VOTD_VERSIONS, 100: { ...VOTD_VERSIONS[2692], abbr: 'NASB 1995' }, 1588: { ...VOTD_VERSIONS[2692], abbr: 'AMP' } });
    for (const [id, abbr] of [[2692, 'NASB 2020'], [100, 'NASB 1995'], [1588, 'AMP']]) {
      const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument((v) => localStorage.setItem('lc:v1:bible-version', v), String(id)) });
      await waitVerse(page, abbr);
      const card = await verseCard(page);
      assert.deepEqual([card.notice, card.link], [abbr, [abbr, 'https://www.lockman.org/']], `${abbr}: just the tag, as a link`);
      assert.doesNotMatch(await text(page, '.verse-card'), /Copyright|Used by permission/);
      await context.close();
    }
  });

  it('shows the notice one size smaller and lighter than the reference, readable, with its link', async () => {
    await seedVotd();
    const { page, context } = await open('#/');
    await waitVerse(page, 'NIV');
    const style = await page.evaluate(() => {
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const cite = document.querySelector('.verse-card cite');
      const notice = document.querySelector('.verse-notice');
      return { cite: px(cite), notice: px(notice), citeLum: lum(getComputedStyle(cite).color), noticeLum: lum(getComputedStyle(notice).color), link: !!notice.querySelector('a[href="https://www.biblica.com"]') };
    });
    assert.ok(style.notice < style.cite && style.notice >= 11, `notice ${style.notice}px, reference ${style.cite}px`);
    assert.ok(style.noticeLum > style.citeLum, 'lighter grey than the reference');
    assert.ok(style.link);
    assert.match(await text(page, '.verse-notice'), /Biblica, Inc\./, 'Biblica keeps the full notice');
    await shot(page, 'home-niv');
    await context.close();
  });

  it('shows the Chinese version with its Biblica notice and link', async () => {
    await seedVotd();
    const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument(() => localStorage.setItem('lc:v1:bible-version', '1392')) });
    await waitVerse(page, 'CCBT');
    const card = await verseCard(page);
    assert.deepEqual([card.text, card.reference, card.notice, card.link], ['神愛世人，甚至將他的獨生子賜給他們。', '約翰福音 3:16', 'Chinese notice © Biblica, Inc. Biblica', ['Biblica', 'https://www.biblica.com/']]);
    assert.equal(await page.$eval('.verse-card blockquote', (b) => b.lang), 'zh-Hant');
    await context.close();
  });

  it('shows a Lockman version as a tag linking to Lockman, and other versions with only the link they supply', async () => {
    await seedVotd();
    const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument(() => localStorage.setItem('lc:v1:bible-version', '2692')) });
    await waitVerse(page, 'NASB 2020');
    const card = await verseCard(page);
    assert.deepEqual([card.notice, card.link], ['NASB 2020', ['NASB 2020', 'https://www.lockman.org/']], 'the version tag, as a link');
    await pickVersion(page, 'web', 206);
    await waitVerse(page, 'WEB');
    const web = await verseCard(page);
    assert.equal(web.notice, 'worldenglishbible.org', 'only the publisher link is shown: no notice is invented for a version that supplies none');
    assert.deepEqual(web.link, ['worldenglishbible.org', 'https://worldenglishbible.org/']);
    await context.close();
  });

  it('falls back to the built-in KJV verse, labelled KJV, when the day has no text or lacks the chosen version', async () => {
    const { page, context } = await open('#/');
    await waitVerse(page, 'KJV'); // nothing is saved in votd for today
    assert.deepEqual(await verseCard(page), { chip: 'KJV', text: 'The LORD is my shepherd; I shall not want.', reference: 'Psalm 23:1', notice: '', link: null, notes: [] });
    await context.close();

    await seedVotd({ 206: VOTD_VERSIONS[206] }); // today has WEB only
    const second = await open('#/');
    await waitVerse(second.page, 'KJV'); // NIV, the default, is missing
    assert.equal((await verseCard(second.page)).text, 'The LORD is my shepherd; I shall not want.');
    await pickVersion(second.page, 'web', 206);
    await waitVerse(second.page, 'WEB');
    assert.equal((await verseCard(second.page)).reference, 'John 3:16');
    await pickVersion(second.page, 'ccb', 1392); // not in today's text
    await waitVerse(second.page, 'KJV');
    assert.equal(await second.page.evaluate(() => localStorage.getItem('lc:v1:bible-version')), '1392', 'the choice is kept for the days that have it');
    await second.context.close();
  });

  it('falls back when a Biblica text arrives without its notice', async () => {
    await seedVotd({ 111: { ...VOTD_VERSIONS[111], notice: '' } });
    const { page, context } = await open('#/');
    await waitVerse(page, 'KJV');
    assert.equal((await verseCard(page)).notice, '');
    await context.close();
  });

  it('sets a long passage smaller so the card stays readable, and keeps its line breaks', async () => {
    const long = Array.from({ length: 25 }, (_, i) => `${i + 16} For God so loved the world, that he gave his only Son.`).join('\n');
    await seedVotd({ 206: { ...VOTD_VERSIONS[206], text: long } });
    const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument(() => localStorage.setItem('lc:v1:bible-version', '206')) });
    await waitVerse(page, 'WEB');
    const size = await page.$eval('.verse-card blockquote', (b) => ({ font: parseFloat(getComputedStyle(b).fontSize), cls: b.className, lines: b.innerText.split('\n').length, overflow: b.scrollWidth > b.clientWidth }));
    assert.deepEqual([size.cls, size.font < 28, size.lines >= 25, size.overflow], ['xlong', true, true, false]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await checkAccessibility(page, 'Home with a long passage');
    await context.close();
  });
  it('has an accessible Home card in every language', async () => {
    await seedVotd();
    for (const id of ['111', '2730', '1392']) {
      const { page, context } = await open('#/', { setup: (p) => p.evaluateOnNewDocument((v) => localStorage.setItem('lc:v1:bible-version', v), id) });
      await page.waitForSelector('.verse-notice');
      await checkAccessibility(page, `Home verse card ${id}`);
      await context.close();
    }
  });

  it('lists every version with its notice and publisher link on the Contact page', async () => {
    await seedVotd();
    const { page, context } = await open('#/contact');
    await page.waitForFunction(() => document.querySelectorAll('#bible-versions li .ct-bv-notice').length >= 5, { timeout: 15000 });
    assert.equal(await text(page, '#bible-versions h2'), 'About Bible versions');
    assert.equal((await page.$$('#bible-versions li')).length, 18);
    const row = (id) => page.$eval(`#bible-versions li[data-version="${id}"]`, (li) => ({ notice: li.querySelector('.ct-bv-notice')?.textContent ?? '', link: li.querySelector('a') ? [li.querySelector('a').textContent, li.querySelector('a').href] : null }));
    assert.deepEqual(await row(111), { notice: NIV_NOTICE, link: ['Biblica', 'https://www.biblica.com/'] });
    assert.deepEqual(await row(2692), { notice: NASB_NOTICE, link: ['The Lockman Foundation', 'https://www.lockman.org/'] });
    assert.match((await row(100)).notice, /NASB 1995 Copyright © 1960, 1971, 1977, 1995 by The Lockman Foundation/); // the fixed Lockman notice, even when the day has no text for it
    assert.match((await row(1588)).notice, /^Scripture quotations from the Amplified® Bible – AMP Copyright © 2015/);
    assert.deepEqual((await row(1588)).link, ['The Lockman Foundation', 'https://www.lockman.org/']);
    for (const id of [111, 2730, 2431, 179, 36, 1392]) assert.match((await row(id)).link[0], /Biblica/, `version ${id}`);
    assert.equal(await page.$$eval('#bible-versions h3', (els) => els.map((e) => e.textContent).join(',')), 'English,Tamil,Telugu,Malayalam,Thai,Mandarin');
    await checkAccessibility(page, 'Contact with Bible versions');
    await context.close();
  });

  it('lets staff schedule a passage from a book, chapter and verses, and lists only the date and reference', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    await page.click('button[aria-pressed]::-p-text(Verses)');
    await page.waitForSelector('#verses-book');
    assert.deepEqual(await page.$$eval('form .field label', (els) => els.map((e) => e.textContent)), ['Date', 'Book', 'Chapter', 'Verse from', 'Verse to (optional)']);
    const books = await page.$$eval('#verses-book option', (els) => els.map((e) => e.textContent));
    assert.equal(books.length, 66);
    assert.deepEqual([books[0], books[38], books[39], books[65]], ['Genesis', 'Malachi', 'Matthew', 'Revelation']);
    assert.equal(await page.$('#verses-reference'), null, 'the old Reference box is gone');
    assert.equal(await page.$('#verses-text'), null, 'the old Verse box is gone');
    assert.equal(await page.$('#verses-translation'), null, 'the old Translation menu is gone');
    await page.select('#verses-book', 'JHN');
    const boxes = await page.$$eval('#verses-chapter, #verses-verseFrom, #verses-verseTo', (els) => els.map((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return [e.type, e.getAttribute('inputmode'), Math.round(r.width), Math.round(r.height), cs.borderTopWidth, cs.borderRadius, cs.fontSize, cs.paddingLeft];
    }));
    assert.deepEqual(boxes[1], boxes[0], 'Verse from looks like Chapter');
    assert.deepEqual(boxes[2], boxes[0], 'Verse to looks like Chapter');
    assert.deepEqual([boxes[0][0], boxes[0][1]], ['text', 'numeric'], 'plain boxes: no up and down arrows');
    await page.type('#verses-chapter', '22');
    await page.type('#verses-verseFrom', '1');
    await page.click('form button[type=submit]');
    await waitText(page, 'John has 21 chapters.', '[role=status]');
    await page.$eval('#verses-chapter', (i) => { i.value = ''; });
    await page.$eval('#verses-verseFrom', (i) => { i.value = ''; });
    await page.type('#verses-chapter', '3');
    await page.type('#verses-verseFrom', '16');
    await page.type('#verses-verseTo', '17');
    await shot(page, 'staff-verse-form');
    await page.click('form button[type=submit]');
    const tomorrow = addDays(TODAY, 1);
    await waitText(page, `${dayLabel(tomorrow)} · John 3:16-17`, '.items');
    assert.equal(await page.$eval('.items li:first-child .meta', (m) => m.textContent), '', 'the list shows the date and reference only');
    const saved = await readDoc('verses', tomorrow);
    assert.deepEqual([saved.passageId, saved.reference, saved.text, saved.translation, saved.updatedBy], ['JHN.3.16-17', 'John 3:16-17', undefined, undefined, STAFF]);
    assert.deepEqual(Object.keys(saved).sort(), ['passageId', 'reference', 'updatedAt', 'updatedBy'], 'a new verse is saved with only its passage');
    await context.close();
  });

  it('refuses a passage of more than 25 verses, and accepts exactly 25', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    await page.click('button[aria-pressed]::-p-text(Verses)');
    await page.waitForSelector('#verses-book');
    await page.select('#verses-book', 'PSA');
    await page.type('#verses-chapter', '119');
    await page.type('#verses-verseFrom', '1');
    await page.type('#verses-verseTo', '26');
    await page.click('form button[type=submit]');
    await waitText(page, 'Choose 25 verses or fewer.', '[role=status]');
    const tomorrow = addDays(TODAY, 1);
    assert.equal((await readDoc('verses', tomorrow)) !== undefined, false);
    await page.$eval('#verses-verseTo', (i) => { i.value = ''; });
    await page.type('#verses-verseTo', '25');
    await page.click('form button[type=submit]');
    await waitText(page, `${dayLabel(tomorrow)} · Psalm 119:1-25`, '.items');
    await context.close();
  });

  it('opens an old-style scheduled verse as a book, chapter and verse', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    await page.click('button[aria-pressed]::-p-text(Verses)');
    await waitText(page, `${dayLabel(TODAY)} · Psalm 23:1`, '.items');
    await page.click('button[aria-label="Edit ' + dayLabel(TODAY) + ' · Psalm 23:1"]');
    await page.waitForSelector('#verses-book');
    assert.deepEqual(await page.evaluate(() => ['verses-book', 'verses-chapter', 'verses-verseFrom', 'verses-verseTo'].map((id) => document.getElementById(id).value)), ['PSA', '23', '1', '']);
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.', '[role=status]');
    const saved = await readDoc('verses', TODAY);
    assert.deepEqual([saved.passageId, saved.reference], ['PSA.23.1', 'Psalm 23:1']);
    assert.deepEqual(Object.keys(saved).sort(), ['passageId', 'reference', 'updatedAt', 'updatedBy'], 'the old text and translation are gone');
    await context.close();
  });

  it('edits a verse saved as it was live before Bible versions, through the form and the rules, and drops the old text', async () => {
    const day = addDays(TODAY, 4);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'verses', day), { reference: 'Psalms 139:23 NKJV', text: 'Search me, O God, and know my heart; try me, and know my anxieties.', translation: 'NKJV', updatedBy: STAFF }));
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    await page.click('button[aria-pressed]::-p-text(Verses)');
    await waitText(page, `${dayLabel(day)} · Psalms 139:23 NKJV`, '.items');
    await page.click('button[aria-label="Edit ' + dayLabel(day) + ' · Psalms 139:23 NKJV"]');
    await page.waitForSelector('#verses-book');
    assert.deepEqual(await page.evaluate(() => ['verses-book', 'verses-chapter', 'verses-verseFrom', 'verses-verseTo'].map((id) => document.getElementById(id).value)), ['PSA', '139', '23', '']);
    assert.equal(await page.$('#verses-text'), null, 'no old Verse box to carry the old text');
    await page.type('#verses-verseTo', '24');
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.', '[role=status]');
    await waitText(page, `${dayLabel(day)} · Psalm 139:23-24`, '.items');
    const saved = await readDoc('verses', day);
    assert.deepEqual(Object.keys(saved).sort(), ['passageId', 'reference', 'updatedAt', 'updatedBy']);
    assert.deepEqual([saved.passageId, saved.reference], ['PSA.139.23-24', 'Psalm 139:23-24']);
    await context.close();
  });
});

describe('Launch pop-up', () => {
  const HOUR = 3600000;
  const UPLOADS = 'https://lifecentre-uploads.lifecentre-app-prototype.workers.dev/';
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
  const PNG = readFileSync(new URL('../icons/favicon-32.png', import.meta.url));
  // The upload Worker and the storage bucket, faked: every call is recorded.
  const fakeUploads = (calls = []) => async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      const u = req.url();
      if (req.method() === 'OPTIONS' && u.startsWith(UPLOADS)) return req.respond({ status: 204, headers: CORS });
      if (u.startsWith(`${UPLOADS}upload?`)) { // the file itself goes to the Worker, which puts it in the bucket
        const q = new URL(u).searchParams;
        calls.push({ sign: { kind: q.get('kind'), contentType: req.headers()['content-type'] || '', size: Number(q.get('size')) }, auth: req.headers().authorization, put: u, type: req.headers()['content-type'] || '' });
        return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ key: 'popups/2026/11/1.jpg', publicUrl: 'https://media.test/popups/1.jpg', bytes: Number(q.get('size')) }) });
      }
      if (u.startsWith('https://media.test/')) return req.respond({ status: 200, contentType: 'image/png', body: PNG });
      return req.continue();
    });
  };
  const atTime = (ms) => (p) => p.evaluateOnNewDocument((start) => { const real = Date.now; const shift = start - real(); Date.now = () => real() + shift; }, ms);
  const both = (...steps) => async (p) => { for (const step of steps) await step(p); };
  const T = Timestamp.fromMillis;
  const seedPopup = (id, fields) => env.withSecurityRulesDisabled((ctx) => {
    const full = { title: 'Christmas service', image: 'https://media.test/popups/1.jpg', start: T(Date.now() - HOUR), end: T(Date.now() + 72 * HOUR), status: 'live', requestedBy: ADMIN, approvedBy: ADMIN, updatedBy: ADMIN, createdAt: T(Date.now() - 2 * HOUR), updatedAt: T(Date.now() - HOUR), ...fields };
    return setDoc(doc(ctx.firestore(), 'popups', id), Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined)));
  });
  const setConfig = (fields) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'config', 'app'), { popupsOn: true, livePopupId: 'p1', updatedBy: ADMIN, ...fields }));
  const setApprover = (email, on) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'staff', email), { role: email === ADMIN ? 'admin' : email === LEADER ? 'leader' : 'staff', approvePopups: on, updatedBy: ADMIN }));
  async function allPopups() {
    let list = [];
    await env.withSecurityRulesDisabled(async (ctx) => { list = (await getDocs(collection(ctx.firestore(), 'popups'))).docs.map((d) => ({ id: d.id, ...d.data() })); });
    return list;
  }
  // Everything this describe makes is removed again, so no pop-up turns up in other tests.
  const clean = () => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const d of (await getDocs(collection(db, 'popups'))).docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db, 'config', 'app'));
    await setApprover(LEADER, false);
    await setApprover(STAFF, false);
  });
  beforeEach(clean);
  after(clean);
  // Puts a freshly drawn picture on a file input.
  const choosePicture = (page, selector) => page.evaluate(async (sel) => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 1200, 900); grad.addColorStop(0, '#1B1740'); grad.addColorStop(1, '#E5326B');
    g.fillStyle = grad; g.fillRect(0, 0, 1200, 900);
    g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText('CHRISTMAS', 120, 480);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'banner.jpg', { type: 'image/jpeg' }));
    const input = document.querySelector(sel);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
  const setDateTime = (page, selector, ms) => page.evaluate((sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, selector, new Date(ms + 8 * HOUR).toISOString().slice(0, 16));

  it('admins give a person "Can approve pop-ups" on the staff list', async () => {
    const { page, context } = await openAsStaff('/staff', ADMIN, { width: 760, height: 1100 });
    await page.click('button[aria-pressed]::-p-text(Staff)');
    await page.waitForSelector('#staff-approvePopups');
    assert.equal(await page.$eval('label[for=staff-approvePopups]', (l) => l.textContent), 'Can approve pop-ups');
    await page.waitForSelector(`button[aria-label="Edit ${LEADER}"]`); // the list loads after the form
    await page.click(`button[aria-label="Edit ${LEADER}"]`);
    await page.waitForFunction((m) => document.querySelector('#staff-email')?.value === m, {}, LEADER);
    await page.click('#staff-approvePopups');
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.', '[role=status]');
    assert.equal((await readDoc('staff', LEADER)).approvePopups, true);
    await waitText(page, 'Approves pop-ups', '.items');
    await shot(page, 'popup-staff-roles');
    await context.close();
  });

  it('the Pop-ups section: the switch starts off; a banner is cropped to 4:5, uploaded through the Worker, and "Make live" fills the live slot', async () => {
    const calls = [];
    const { page, context } = await openAsStaff('/staff?section=popups', ADMIN, { width: 760, height: 1100, setup: fakeUploads(calls) });
    await page.waitForSelector('.pu-panel:not([aria-busy])'); // drawn with its data, so nothing is redrawn under a click
    assert.equal(await page.$eval('.pu-panel .cr-switch', (b) => b.getAttribute('aria-checked')), 'false');
    assert.match(await text(page, '.pu-state'), /^Off: nothing shows to members/);
    assert.deepEqual(await page.$$eval('.switch .btn', (els) => els.map((b) => b.textContent)), ['Notices', 'Verses', 'Events', 'Staff', 'Pop-ups']);
    await page.click('.pu-panel .btn::-p-text(New pop-up)');
    await page.waitForSelector('#pu-title');
    await page.type('#pu-title', 'Christmas service');
    await choosePicture(page, '#pu-file');
    await page.waitForSelector('img.pu-preview');
    const preview = await page.$eval('img.pu-preview', async (img) => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
    assert.deepEqual(preview, [1080, 1350], 'cropped to the pop-up shape');
    await setDateTime(page, '#pu-start', Date.now() - HOUR);
    await setDateTime(page, '#pu-end', Date.now() + 2 * 24 * HOUR);
    await page.select('#pu-event', 'conf');
    await page.evaluate(() => document.querySelector('.pu-panel').scrollIntoView());
    await shot(page, 'popup-admin');
    await checkAccessibility(page, 'Pop-ups section');
    const pageLog = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageLog.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => pageLog.push(`pageerror: ${e.message}`));
    await page.click('.pu-panel .btn::-p-text(Make live)');
    try { await waitText(page, 'It is now the live pop-up.', '[role=status]'); } catch (e) {
      throw new Error(`Make live did not finish.\nStatus: ${await page.$$eval('[role=status]', (els) => els.map((s) => s.textContent).join(' | '))}\nCalls: ${JSON.stringify(calls)}\nLog: ${pageLog.join('\n')}`);
    }
    const [sign, put] = [calls.find((c) => c.sign), calls.find((c) => c.put)];
    assert.deepEqual([sign.sign.kind, sign.sign.contentType, sign.sign.size > 10000, sign.auth.startsWith('Bearer ')], ['popups', 'image/jpeg', true, true]);
    assert.deepEqual([put.put.startsWith(`${UPLOADS}upload?kind=popups&size=`), put.type], [true, 'image/jpeg'], 'the file itself goes to the Worker');
    const [saved] = await allPopups();
    assert.deepEqual([saved.title, saved.image, saved.eventId, saved.status, saved.requestedBy, saved.approvedBy, saved.end.toMillis() > Date.now()], ['Christmas service', 'https://media.test/popups/1.jpg', 'conf', 'live', ADMIN, ADMIN, true]);
    assert.deepEqual([(await readDoc('config', 'app')).livePopupId, (await readDoc('config', 'app')).popupsOn], [saved.id, false]);
    await waitText(page, 'Live now', '.pu-panel');
    await page.waitForSelector('.pu-panel:not([aria-busy])');
    await page.click('.pu-panel .cr-switch');
    await waitText(page, 'Pop-ups are on.', '[role=status]');
    assert.equal((await readDoc('config', 'app')).popupsOn, true);
    await page.waitForSelector('.pu-panel:not([aria-busy])'); // the section is drawn again after an action
    await page.click('.pu-panel .btn::-p-text(Take down)');
    await waitText(page, 'Taken down.', '[role=status]');
    assert.deepEqual([(await allPopups())[0].status, (await readDoc('config', 'app')).livePopupId], ['ended', null]);
    await context.close();
  });

  it('members see the live pop-up once a day on their first open, can close it, and tapping it opens the event', async () => {
    await seedPopup('p1', { eventId: 'conf' });
    await setConfig({});
    const { page, errors, context } = await open('#/', { setup: fakeUploads() });
    await page.waitForSelector('.pu-card');
    const card = await page.$eval('.pu-card', (c) => ({ role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), title: c.querySelector('#pu-title').textContent, img: c.querySelector('img').getAttribute('src'), href: c.querySelector('.pu-image').getAttribute('href'), focused: document.activeElement?.className }));
    assert.deepEqual(card, { role: 'dialog', modal: 'true', title: 'Christmas service', img: 'https://media.test/popups/1.jpg', href: '#/events/conf', focused: 'pu-x' });
    await shot(page, 'popup-member');
    await checkAccessibility(page, 'Member pop-up');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.pu-card'), null, 'Escape closes it');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('lc:v1:popupSeen'))), { id: 'p1', day: TODAY });
    await page.reload();
    await page.waitForSelector('#page-title');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$('.pu-card'), null, 'not again today');
    assert.deepEqual(errors, []);
    await context.close();
    // the next day it shows again, and a tap on the picture opens the event
    const next = await open('#/', { setup: both(fakeUploads(), atTime(Date.now() + 24 * HOUR)) });
    await next.page.waitForSelector('.pu-card');
    await next.page.click('.pu-image');
    await next.page.waitForFunction(() => location.hash === '#/events/conf');
    assert.equal(await next.page.$('.pu-card'), null);
    await next.context.close();
    // the backdrop and the close button both close it; the close button is where the keyboard starts
    const third = await open('#/', { setup: both(fakeUploads(), atTime(Date.now() + 48 * HOUR)) });
    await third.page.waitForSelector('.pu-card');
    await third.page.click('.pu-x');
    assert.equal(await third.page.$('.pu-card'), null);
    await third.context.close();
  });

  it('shows nothing when the switch is off, outside the start and end, when another pop-up is in the slot, and ends by itself at its end', async () => {
    await seedPopup('p1', {});
    await setConfig({ popupsOn: false });
    const quiet = async (label, setup = fakeUploads()) => { const { page, context } = await open('#/', { setup }); await page.waitForSelector('.verse-card'); await new Promise((r) => setTimeout(r, 1500)); assert.equal(await page.$('.pu-card'), null, label); await context.close(); };
    await quiet('switch off');
    await setConfig({});
    await seedPopup('p1', { start: T(Date.now() + HOUR) });
    await quiet('not started');
    await seedPopup('p1', { end: T(Date.now() - 1000), start: T(Date.now() - HOUR) });
    await quiet('already ended');
    await seedPopup('p1', {});
    await setConfig({ livePopupId: 'other' });
    await quiet('a different pop-up is in the slot');
    await setConfig({});
    await seedPopup('p1', { end: T(Date.now() + 7000) });
    const { page, context } = await open('#/', { setup: fakeUploads() });
    await page.waitForSelector('.pu-card', { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('.pu-card'), { timeout: 10000 });
    await context.close();
  });

  it('staff with a banner on their event can request a launch pop-up, which goes only to the approvers', async () => {
    await setApprover(LEADER, true);
    const { page, context } = await openAsStaff('/events/new', STAFF);
    await page.waitForSelector('.cr-name');
    await page.type('.cr-name', 'Carols night');
    await page.click('.cr-btn::-p-text(Choose location)');
    await page.click('.cr-chips .chip::-p-text(Yishun)');
    assert.equal(await page.$('.cr-switch[aria-label="Request a launch pop-up for everyone"]'), null, 'no banner, no request');
    await choosePicture(page, 'input[type=file]');
    await page.waitForSelector('.cover.photo');
    await page.waitForSelector('.cr-switch[aria-label="Request a launch pop-up for everyone"]');
    await page.select('select[aria-label="Visibility"]', 'draft');
    await page.waitForFunction(() => !document.querySelector('.cr-switch[aria-label="Request a launch pop-up for everyone"]'), {}, 'a draft event cannot ask for a pop-up');
    await page.select('select[aria-label="Visibility"]', 'public');
    await page.waitForSelector('.cr-switch[aria-label="Request a launch pop-up for everyone"]');
    await page.click('.cr-switch[aria-label="Request a launch pop-up for everyone"]');
    await page.waitForSelector('input[aria-label="Pop-up start"]');
    const [from, until, endDate, endTime] = await page.evaluate(() => [document.querySelector('input[aria-label="Pop-up start"]').value, document.querySelector('input[aria-label="Pop-up end"]').value, document.querySelector('input[aria-label="End date"]').value, document.querySelector('input[aria-label="End time"]').value]);
    assert.ok(from.length === 16, 'starts now');
    assert.equal(until, `${endDate}T${endTime}`, 'ends with the event');
    await page.evaluate(() => document.querySelector('.cr-popup').scrollIntoView({ block: 'center' }));
    await shot(page, 'popup-request');
    await page.click('.cr-submit');
    await waitText(page, 'Your launch pop-up request has gone to the approvers.');
    const [req] = await allPopups();
    const eventId = await page.$eval('a.btn[href^="#/events/"]', (a) => a.getAttribute('href').split('/').pop());
    assert.deepEqual([req.title, req.status, req.requestedBy, req.eventId, req.image.startsWith('data:image/jpeg;base64,'), req.end.toMillis() > req.start.toMillis()], ['Carols night', 'requested', STAFF, eventId, true, true]);
    // editing the event shows where the request stands
    await goto(page, `/events/${eventId}/edit`);
    await waitText(page, 'Pop-up request: waiting for an approver.');
    await context.close();
    // the requester is not told about their own request; approvers (the switch, or admins) are; other staff are not
    const sees = async (email, expected, label) => {
      const o = await openAsStaff('/notifications', email);
      await new Promise((r) => setTimeout(r, 1200));
      const rows = await o.page.$$eval('.nf-row', (els) => els.map((r) => [r.querySelector('b').textContent, r.getAttribute('href')]));
      const row = rows.find(([t]) => t === 'Pop-up request: Carols night');
      assert.equal(!!row, expected, label);
      if (expected) assert.equal(row[1], '#/staff?section=popups');
      await o.context.close();
    };
    await sees(STAFF, false, 'the requester');
    await sees(LEADER, true, 'an approver');
    await sees(ADMIN, true, 'an admin');
    await setApprover(LEADER, false);
    await sees(LEADER, false, 'a leader without the switch');
  });

  it('approving with no pop-up live makes the request live; with another live, the approver replaces it or keeps it (declining with a note); nobody approves their own', async () => {
    await setApprover(LEADER, true);
    await seedPopup('r1', { title: 'Carols night', status: 'requested', requestedBy: STAFF, approvedBy: undefined, eventId: 'conf', image: 'https://media.test/popups/r1.jpg' }); // served by fakeUploads, so the thumbnail renders in the screenshot
    await seedPopup('l1', { title: 'Live one' });
    await setConfig({ livePopupId: 'l1', popupsOn: false }); // off, or the pop-up itself would open over the staff page (staff see it like everyone else)
    const { page, context } = await openAsStaff('/staff?section=popups', LEADER, { width: 760, height: 1100, setup: fakeUploads() });
    await page.waitForSelector('.pu-panel:not([aria-busy])');
    assert.equal(await page.$('.pu-panel .cr-switch'), null, 'the master switch is for admins');
    await waitText(page, 'Live one', '.pu-panel');
    const row = await page.$eval('.pu-list .pu-row', (r) => ({ title: r.querySelector('b').textContent, from: [...r.querySelectorAll('.meta')].map((m) => m.textContent), thumb: !!r.querySelector('img.pu-thumb') }));
    assert.deepEqual([row.title, row.from[1], row.thumb], ['Carols night', `From ${STAFF}`, true]);
    const pageLog = [];
    page.on('console', (m) => pageLog.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => pageLog.push(`pageerror: ${e.message}`));
    await page.click('button[aria-label="Approve Carols night"]');
    try { await page.waitForSelector('.pu-choice', { timeout: 8000 }); } catch (e) {
      throw new Error(`no Replace/Keep choice after Approve.\nPanel: ${await page.$eval('.pu-panel', (el) => el.innerText.replace(/\n+/g, ' | '))}\nLog: ${pageLog.join('\n')}`);
    }
    assert.match(await text(page, '.pu-choice'), /Live one is live until .*Only one pop-up can be live/);
    await shot(page, 'popup-approve-choice');
    await page.click('.pu-choice .btn::-p-text(Keep the current one)');
    await waitText(page, 'Declined. The current pop-up stays', '[role=status]');
    let byId = Object.fromEntries((await allPopups()).map((p) => [p.id, p]));
    assert.deepEqual([byId.r1.status, byId.r1.approvedBy, byId.l1.status, (await readDoc('config', 'app')).livePopupId], ['declined', LEADER, 'live', 'l1']);
    assert.match(byId.r1.note, /^Another pop-up, "Live one", is live until /);
    // the same again, replacing
    await seedPopup('r1', { title: 'Carols night', status: 'requested', requestedBy: STAFF, approvedBy: undefined });
    await page.reload();
    await page.waitForSelector('button[aria-label="Approve Carols night"]');
    await page.click('button[aria-label="Approve Carols night"]');
    await page.waitForSelector('.pu-choice');
    await page.click('.pu-choice .btn::-p-text(Replace the current pop-up)');
    await waitText(page, 'It replaced the pop-up that was live.', '[role=status]');
    byId = Object.fromEntries((await allPopups()).map((p) => [p.id, p]));
    assert.deepEqual([byId.r1.status, byId.r1.approvedBy, byId.l1.status, (await readDoc('config', 'app')).livePopupId], ['live', LEADER, 'ended', 'r1']);
    // declining with a note, which the requester then sees in Notifications
    await seedPopup('r2', { title: 'Youth camp', status: 'requested', requestedBy: STAFF, approvedBy: undefined });
    await page.reload();
    await page.waitForSelector('button[aria-label="Decline Youth camp"]');
    await page.click('button[aria-label="Decline Youth camp"]');
    await page.waitForSelector('#pu-note');
    await page.type('#pu-note', 'Please pick a date after the carols.');
    await page.click('.pu-decline .btn::-p-text(Decline with this note)');
    await waitText(page, 'Declined, with your note', '[role=status]');
    byId = Object.fromEntries((await allPopups()).map((p) => [p.id, p]));
    assert.deepEqual([byId.r2.status, byId.r2.note], ['declined', 'Please pick a date after the carols.']);
    await context.close();
    const requester = await openAsStaff('/notifications', STAFF);
    await waitText(requester.page, 'Your pop-up request was declined: Youth camp');
    await waitText(requester.page, 'Please pick a date after the carols.');
    await requester.context.close();
    // nobody approves their own request, even with the switch
    await setApprover(STAFF, true);
    await seedPopup('r3', { title: 'My own', status: 'requested', requestedBy: STAFF, approvedBy: undefined });
    const own = await openAsStaff('/staff?section=popups', STAFF, { width: 760, height: 1100 });
    await own.page.waitForSelector('button[aria-label="Approve My own"]');
    assert.equal(await own.page.$eval('button[aria-label="Approve My own"]', (b) => b.disabled), true);
    await waitText(own.page, 'Your own request: someone else approves it.', '.pu-panel');
    await own.context.close();
    // with nothing live, an admin's approval goes straight to live
    await setConfig({ livePopupId: null });
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'popups', 'r1'), { status: 'ended' }, { merge: true }));
    const admin = await openAsStaff('/staff?section=popups', ADMIN, { width: 760, height: 1100 });
    await admin.page.waitForSelector('button[aria-label="Approve My own"]');
    await admin.page.click('button[aria-label="Approve My own"]');
    await waitText(admin.page, 'Approved. It is now the live pop-up.', '[role=status]');
    byId = Object.fromEntries((await allPopups()).map((p) => [p.id, p]));
    assert.deepEqual([byId.r3.status, byId.r3.approvedBy, (await readDoc('config', 'app')).livePopupId], ['live', ADMIN, 'r3']);
    await admin.context.close();
  });
});

describe('Stories', () => {
  const HOUR = 3600000;
  const UPLOADS = 'https://lifecentre-uploads.lifecentre-app-prototype.workers.dev/';
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
  const PNG = readFileSync(new URL('../icons/favicon-32.png', import.meta.url));
  const SAM = 'sam@lifecentre.sg';
  const GRACE = 'grace@lifecentre.sg';
  const V = 'https://media.test/stories/v.webm';
  const A = 'https://media.test/stories/a.webm';
  const files = new Map(); // address -> { type, body }: a video and a voice recording made with the fake camera and microphone
  const T = Timestamp.fromMillis;
  // The upload Worker and the storage bucket, faked; the bucket serves the recordings, with ranges, as a real one would.
  const fakeMedia = (calls = []) => async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      const u = req.url();
      if (req.method() === 'OPTIONS' && u.startsWith(UPLOADS)) return req.respond({ status: 204, headers: CORS });
      if (u.startsWith(`${UPLOADS}upload?`)) { // the file itself goes to the Worker, which puts it in the bucket
        const q = new URL(u).searchParams;
        const body = { kind: q.get('kind'), contentType: req.headers()['content-type'] || '', size: Number(q.get('size')) };
        const n = calls.filter((c) => c.sign).length + 1;
        const key = `${body.kind}/2026/11/${n}.${(body.contentType || 'x/bin').split('/')[1].split(';')[0]}`;
        calls.push({ sign: body, auth: req.headers().authorization, key, put: u, type: body.contentType });
        return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ key, publicUrl: `https://media.test/${key}`, bytes: body.size }) });
      }
      if (u.startsWith('https://media.test/')) {
        const f = files.get(u) ?? { type: 'image/png', body: PNG };
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), f.body.length - 1) : f.body.length - 1;
          return req.respond({ status: 206, headers: { 'content-type': f.type, 'content-range': `bytes ${start}-${end}/${f.body.length}`, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) }, body: f.body.subarray(start, end + 1) });
        }
        return req.respond({ status: 200, headers: { 'content-type': f.type, 'accept-ranges': 'bytes', 'content-length': String(f.body.length) }, body: f.body });
      }
      return req.continue();
    });
  };
  const seedStory = (id, fields) => env.withSecurityRulesDisabled((ctx) => {
    const now = Date.now();
    const full = { author: SAM, authorName: 'Samuel Tan', type: 'video', mediaUrl: V, mediaType: 'video/webm', colours: ['#1B1740', '#3558C8'], duration: 9, parts: [{ start: 0, end: 3 }, { start: 3, end: 6 }, { start: 6, end: 9 }], views: 0, createdAt: T(now - HOUR), expiresAt: T(now + 23 * HOUR), updatedBy: SAM, ...fields };
    return setDoc(doc(ctx.firestore(), 'stories', id), Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined)));
  });
  const setPoster = (email, on) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'staff', email), { role: email === ADMIN ? 'admin' : email === LEADER ? 'leader' : 'staff', postStories: on, updatedBy: ADMIN }));
  async function allStories() {
    let list = [];
    await env.withSecurityRulesDisabled(async (ctx) => { list = (await getDocs(collection(ctx.firestore(), 'stories'))).docs.map((d) => ({ id: d.id, ...d.data() })); });
    return list;
  }
  const clean = () => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const d of (await getDocs(collection(db, 'stories'))).docs) await deleteDoc(d.ref);
    await setPoster(STAFF, false);
    await setPoster(LEADER, false);
  });
  const viewer = (page) => page.$eval('.st-stage', (s) => ({ label: s.getAttribute('aria-label'), bars: [...s.querySelectorAll('.st-bar-fill')].map((f) => f.style.width), name: s.querySelector('.st-who b')?.textContent, views: s.querySelector('.st-views')?.hidden === false ? s.querySelector('.st-views').textContent : null, text: s.querySelector('.st-text')?.hidden === false ? s.querySelector('.st-text').textContent : null }));
  const video = (page) => page.$eval('.st-stage video', (v) => ({ paused: v.paused, muted: v.muted, t: v.currentTime }));
  const drag = async (page, from, to) => { await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(to[0], to[1], { steps: 6 }); await page.mouse.up(); };
  const choosePicture = (page, selector) => page.evaluate(async (sel) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#2A1B6B'; g.fillRect(0, 0, 900, 1200); g.fillStyle = '#fff'; g.font = 'bold 100px sans-serif'; g.fillText('HELLO', 200, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'pic.jpg', { type: 'image/jpeg' }));
    const input = document.querySelector(sel); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);

  before(async () => {
    const { page, context } = await open('#/');
    const grab = (constraints, mime, seconds) => page.evaluate(async (c, m, s) => {
      const stream = await navigator.mediaDevices.getUserMedia(c);
      const rec = new MediaRecorder(stream, { mimeType: m });
      const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => { rec.onstop = r; });
      rec.start(250);
      await new Promise((r) => setTimeout(r, s * 1000));
      rec.stop(); await stopped; stream.getTracks().forEach((t) => t.stop());
      const buf = new Uint8Array(await new Blob(chunks, { type: m }).arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, constraints, mime, seconds);
    files.set(V, { type: 'video/webm', body: Buffer.from(await grab({ video: true, audio: true }, 'video/webm', 9.5), 'base64') });
    files.set(A, { type: 'audio/webm', body: Buffer.from(await grab({ audio: true }, 'audio/webm', 5), 'base64') });
    await context.close();
    assert.ok(files.get(V).body.length > 20000 && files.get(A).body.length > 2000, 'the fake camera and microphone made the recordings');
  });
  beforeEach(clean);
  after(clean);

  it('admins give a person "Can post stories" on the staff list; admins always can', async () => {
    const { page, context } = await openAsStaff('/staff', ADMIN, { width: 760, height: 1100 });
    await page.click('button[aria-pressed]::-p-text(Staff)');
    await page.waitForSelector('#staff-postStories');
    assert.equal(await page.$eval('label[for=staff-postStories]', (l) => l.textContent), 'Can post stories (admins always can)');
    await waitText(page, 'Posts stories', '.items');
    assert.match(await page.$eval('.items', (l, who) => [...l.querySelectorAll('.item')].find((i) => i.textContent.includes(who)).textContent, ADMIN), /Posts stories/, 'the admin is marked as a poster without the switch');
    await page.click(`button[aria-label="Edit ${STAFF}"]`);
    await page.waitForFunction((m) => document.querySelector('#staff-email')?.value === m, {}, STAFF);
    await page.click('#staff-postStories');
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.', '[role=status]');
    assert.equal((await readDoc('staff', STAFF)).postStories, true);
    await shot(page, 'stories-staff-roles');
    await context.close();
  });

  it('Home shows no circles until someone posts, then one per person with a live story, newest first, bright until watched', async () => {
    const empty = await open('#/');
    await empty.page.waitForSelector('.verse-card');
    assert.equal(await empty.page.$eval('.st-strip', (s) => s.hidden), true, 'no row while nobody has a story');
    assert.equal((await empty.page.$$('.st-circle')).length, 0);
    await empty.context.close();
    await seedStory('s1', {});
    await seedStory('g1', { author: GRACE, authorName: 'Grace Lim', type: 'text', mediaUrl: undefined, mediaType: undefined, text: 'Praying for you all today', colours: ['#FF6A3D', '#E5326B'], duration: 6, parts: [{ start: 0, end: 1.5 }], createdAt: T(Date.now() - 2 * HOUR) });
    await seedStory('old', { author: 'eve@lifecentre.sg', authorName: 'Eve', type: 'text', mediaUrl: undefined, mediaType: undefined, text: 'Yesterday', duration: 6, parts: [{ start: 0, end: 6 }], createdAt: T(Date.now() - 30 * HOUR), expiresAt: T(Date.now() - 6 * HOUR) });
    const { page, errors, context } = await open('#/', { setup: fakeMedia() });
    await page.waitForFunction(() => document.querySelectorAll('.st-circle').length === 2);
    const row = await page.$$eval('.st-circle', (els) => els.map((c) => ({ label: c.querySelector('.st-label').textContent, seen: c.querySelector('.st-ring').classList.contains('seen'), aria: c.querySelector('.st-ring').getAttribute('aria-label') })));
    assert.deepEqual(row, [{ label: 'Samuel', seen: false, aria: 'Stories from Samuel Tan, 1 story, new' }, { label: 'Grace', seen: false, aria: 'Stories from Grace Lim, 1 story, new' }], 'newest first, expired left out');
    await shot(page, 'stories-home-row-visitor');
    await checkAccessibility(page, 'Home with stories');
    await page.click('.st-circle:nth-child(2) .st-ring');
    await page.waitForSelector('.st-stage');
    assert.deepEqual([(await viewer(page)).name, (await viewer(page)).text ?? await page.$eval('.st-textstory', (t) => t.textContent)], ['Grace Lim', 'Praying for you all today']);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.st-stage'));
    assert.deepEqual(await page.$$eval('.st-ring', (els) => els.map((r) => r.classList.contains('seen'))), [false, true], 'grey once watched');
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.st-circle').length === 2);
    assert.deepEqual(await page.$$eval('.st-ring', (els) => els.map((r) => r.classList.contains('seen'))), [false, true], 'remembered on the phone');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('the viewer plays a recording in parts with a bar per part: tap right and left, hold to pause, sound on, keys, drag to change person, swipe down to close, and the next person follows by itself', async () => {
    await seedStory('s1', {});
    await seedStory('g1', { author: GRACE, authorName: 'Grace Lim', type: 'text', mediaUrl: undefined, mediaType: undefined, text: 'Short one', duration: 6, parts: [{ start: 0, end: 1.5 }], createdAt: T(Date.now() - 2 * HOUR) });
    const { page, errors, context } = await open('#/', { setup: fakeMedia() });
    await page.waitForFunction(() => document.querySelectorAll('.st-circle').length === 2);
    await page.click('.st-circle:first-child .st-ring');
    await page.waitForSelector('.st-stage[role=dialog]');
    assert.equal((await viewer(page)).bars.length, 3, 'a progress bar per part');
    await page.waitForFunction(() => { const v = document.querySelector('.st-stage video'); return v && !v.paused && v.currentTime > 0.4; }, { timeout: 15000 });
    assert.equal((await video(page)).muted, false, 'sound on');
    await page.waitForFunction(() => parseInt(document.querySelector('.st-bar-fill').style.width, 10) > 5);
    assert.match((await viewer(page)).label, /^Stories from Samuel Tan, part 1 of 3$/);
    await shot(page, 'stories-viewer');
    await checkAccessibility(page, 'Story viewer');
    // tap right: the next part, which is further on in the same file
    await page.mouse.click(300, 420);
    await page.waitForFunction(() => document.querySelector('.st-stage').getAttribute('aria-label').endsWith('part 2 of 3'));
    await page.waitForFunction(() => { const v = document.querySelector('.st-stage video'); return v.currentTime >= 2.9 && v.currentTime < 6; }, { timeout: 8000 });
    assert.equal((await viewer(page)).bars[0], '100%', 'the first bar is full');
    // tap left: back a part
    await page.mouse.click(60, 420);
    await page.waitForFunction(() => document.querySelector('.st-stage').getAttribute('aria-label').endsWith('part 1 of 3'));
    await page.waitForFunction(() => { const v = document.querySelector('.st-stage video'); return v.currentTime < 3; }, { timeout: 8000 });
    // hold to pause
    await page.mouse.move(200, 420);
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await video(page)).paused, true, 'paused while held');
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.st-stage video').paused);
    // keys
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.st-stage').getAttribute('aria-label').endsWith('part 2 of 3'));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.st-stage').getAttribute('aria-label').endsWith('part 1 of 3'));
    // a sideways drag: the next person, and back
    await drag(page, [300, 420], [120, 430]);
    await page.waitForFunction(() => document.querySelector('.st-who b')?.textContent === 'Grace Lim');
    assert.equal((await viewer(page)).bars.length, 1);
    await drag(page, [100, 420], [300, 430]);
    await page.waitForFunction(() => document.querySelector('.st-who b')?.textContent === 'Samuel Tan');
    // PageDown: Grace; her short story ends and, being the last person, the viewer closes by itself
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('.st-who b')?.textContent === 'Grace Lim');
    await page.waitForFunction(() => !document.querySelector('.st-stage'), { timeout: 8000 });
    // swipe down closes
    await page.click('.st-circle:first-child .st-ring');
    await page.waitForSelector('.st-stage');
    await drag(page, [200, 300], [205, 480]);
    await page.waitForFunction(() => !document.querySelector('.st-stage'));
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'st-ring seen', 'focus goes back to the circle');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('counts one view per phone, never the poster\'s own, and shows the poster the number', async () => {
    await seedStory('s1', { type: 'photo', mediaUrl: 'https://media.test/stories/p.png', mediaType: 'image/png', duration: 5, parts: [{ start: 0, end: 1 }] });
    const watch = async (page) => { await page.waitForSelector('.st-circle'); await page.click('.st-circle:first-child .st-ring'); await page.waitForSelector('.st-stage'); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.st-stage')); };
    const one = await open('#/', { setup: fakeMedia() });
    await watch(one.page);
    await one.page.waitForFunction(async () => true);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await readDoc('stories', 's1')).views, 1);
    await watch(one.page);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await readDoc('stories', 's1')).views, 1, 'the same phone counts once');
    await one.context.close();
    const two = await open('#/', { setup: fakeMedia() });
    await watch(two.page);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await readDoc('stories', 's1')).views, 2, 'another phone counts');
    await two.context.close();
    const own = await open('#/staff', { setup: fakeMedia() });
    await waitText(own.page, 'Sign in with Google');
    await signIn(own.page, SAM, 'Samuel Tan');
    await goto(own.page, '/');
    await own.page.waitForSelector('.st-circle');
    await own.page.click('.st-circle:first-child .st-ring');
    await own.page.waitForSelector('.st-stage');
    assert.equal((await viewer(own.page)).views, '2 views');
    await own.page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await readDoc('stories', 's1')).views, 2, 'the poster does not count');
    await own.context.close();
  });

  // ---- Posting, like Instagram: the camera opens straight away ----
  const camera = async (page, { partSeconds } = {}) => {
    await page.goto(`${base.replace('?emulator', partSeconds ? `?emulator&partSeconds=${partSeconds}` : '?emulator')}#/stories/new`);
    await page.waitForSelector('.story-cam[data-stage=camera][data-ready]');
    await camOn(page);
  };
  const camOn = (page) => page.waitForFunction(() => (document.querySelector('video.sp-cam')?.videoWidth || 0) > 0, { timeout: 10000 }); // the fake camera is on and sending frames
  const labels = (page, sel) => page.$$eval(sel, (els) => els.map((b) => b.getAttribute('aria-label') ?? b.textContent.trim()));
  const centre = async (page, sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const editor = (page) => page.evaluate(() => window.__storyEditor?.()); // what the editor holds (only against the emulators)
  const recordClicks = (p) => p.evaluateOnNewDocument(() => { window.__clicks = []; HTMLAnchorElement.prototype.click = function () { window.__clicks.push([this.download, this.href.slice(0, 5)]); }; });
  const addText = async (page, words) => {
    await page.click('.sp-rail button[aria-label="Text"]');
    await page.waitForSelector('.sp-edit-input');
    await page.type('.sp-edit-input', words);
    await page.click('button[aria-label="Done"]');
    await page.waitForFunction(() => !document.querySelector('.sp-edit-input'));
  };
  const pinchCamera = (page, from, to) => page.evaluate((d0, d1) => {
    const f = document.querySelector('.sp-cam-frame');
    const r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const ev = (type, id, x) => f.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: x, clientY: cy, bubbles: true, cancelable: true }));
    ev('pointerdown', 21, cx - d0 / 2); ev('pointerdown', 22, cx + d0 / 2);
    for (let k = 1; k <= 5; k++) { const d = d0 + ((d1 - d0) * k) / 5; ev('pointermove', 21, cx - d / 2); ev('pointermove', 22, cx + d / 2); }
    ev('pointerup', 21, cx - d1 / 2); ev('pointerup', 22, cx + d1 / 2);
  }, from, to);
  const PORTRAIT = { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, frameRate: { ideal: 30 }, resizeMode: { exact: 'none' }, zoom: true };
  const framePoint = async (page) => { const f = await (await page.$('.sp-frame')).boundingBox(); return (fx, fy) => [f.x + f.width * fx, f.y + f.height * fy]; };

  it('the camera opens straight away for a poster: STORY mode with the tool rail, the picker, the shutter and the mode switcher; a tap (or Space) takes a photo, and the preview puts words and drawings on it, saves it and posts it', async () => {
    await setPoster(STAFF, true);
    await seedStory('s1', {});
    const calls = [];
    const { page, errors, context } = await openAsStaff('/', STAFF, { setup: async (p) => { await fakeMedia(calls)(p); await recordClicks(p); } });
    // Home: the poster's own circle comes first, "Your story" with a +, even with nothing posted yet
    await page.waitForFunction(() => document.querySelectorAll('.st-circle').length === 2);
    assert.deepEqual(await page.$$eval('.st-circle', (els) => els.map((c) => [c.querySelector('.st-label').textContent, !!c.querySelector('.st-plus'), c.querySelector('.st-ring').getAttribute('href') || c.querySelector('.st-ring').getAttribute('aria-label')])), [['Your story', true, '#/stories/new'], ['Samuel', false, 'Stories from Samuel Tan, 1 story, new']]);
    await shot(page, 'stories-home-row');
    await page.click('.st-circle:first-child .st-ring');
    await page.waitForSelector('.story-cam[data-stage=camera][data-mode=story][data-ready]');
    await camOn(page);
    assert.equal(await page.$('.st-opt'), null, 'no menu in between');
    // the live picture: no sound at all (no microphone until recording starts), inline, from a portrait request, in the story's shape
    let camState = await editor(page);
    assert.deepEqual([camState.previewAudioTracks, camState.micOpen], [0, false], 'no microphone while the camera only shows the picture');
    assert.deepEqual(await page.$eval('video.sp-cam', (v) => [v.muted, v.playsInline, v.volume, v.srcObject.getAudioTracks().length]), [true, true, 0, 0]);
    assert.deepEqual(camState.constraints, { video: { ...PORTRAIT, facingMode: 'user' }, audio: false });
    const shape = await page.$eval('.sp-cam-frame', (f) => { const r = f.getBoundingClientRect(); return r.width / r.height; });
    assert.ok(Math.abs(shape - 9 / 16) < 0.005, `the picture is shown in the shape it is posted in: ${shape}`);
    assert.deepEqual(await labels(page, '.sp-zoom-chips button'), ['Zoom 1x'], 'no 0.5x without a wide lens');
    assert.deepEqual(await labels(page, '.sp-top button'), ['Close', 'Flash off']);
    assert.deepEqual(await labels(page, '.sp-rail button'), ['Text', 'Draw', 'More tools']);
    assert.deepEqual(await labels(page, '.sp-controls [aria-label]'), ['Choose from your phone', 'Take a photo. Hold to record a video', 'Switch camera']);
    assert.deepEqual(await page.$$eval('.sp-modes [role=radio]', (els) => els.map((b) => [b.textContent, b.getAttribute('aria-checked')])), [['STORY', 'true'], ['VOICE', 'false'], ['TEXT', 'false']]);
    assert.deepEqual([(await page.$$('.sp-ring .mark')).length, (await page.$$('.sp-parts .sp-part')).length], [5, 6], 'a mark at every part of up to 6');
    await page.click('.sp-rail button[aria-label="More tools"]');
    assert.deepEqual(await labels(page, '.sp-rail button'), ['Text', 'Draw', 'Fewer tools', 'Hands-free', 'Timer']);
    await page.click('.sp-rail button[aria-label="Fewer tools"]');
    await shot(page, 'stories-camera');
    await checkAccessibility(page, 'Story camera');
    // pinch to zoom: this camera cannot zoom itself, so the picture is zoomed digitally, and the level shows, then hides
    await pinchCamera(page, 60, 150);
    camState = await editor(page);
    assert.ok(Math.abs(camState.zoom - 2.5) < 0.01 && camState.digital === camState.zoom && !camState.cameraZooms, `pinched to 2.5x: ${JSON.stringify(camState)}`);
    assert.match(await page.$eval('video.sp-cam', (v) => v.style.transform), /^scaleX\(-1\) scale\(2\.5\d*\)$/);
    assert.deepEqual(await page.$eval('.sp-zoom', (z) => [z.textContent, z.classList.contains('show')]), ['2.5x', true]);
    await page.waitForFunction(() => !document.querySelector('.sp-zoom').classList.contains('show'), { timeout: 3000 });
    await page.click('.sp-zoom-chips button[aria-label="Zoom 1x"]');
    assert.equal((await editor(page)).zoom, 1, '1x goes back');
    // the keyboard: the arrows zoom, and Space on the shutter takes the photo
    await page.focus('.sp-shutter');
    await page.keyboard.press('ArrowUp');
    assert.equal((await editor(page)).zoom, 1.25);
    await page.keyboard.press('ArrowDown');
    assert.equal((await editor(page)).zoom, 1);
    await page.focus('.sp-shutter');
    await page.keyboard.press('Space');
    await page.waitForSelector('.story-cam[data-stage=preview]');
    assert.equal(await page.$eval('.sp-frame .sp-media', (m) => [m.tagName, m.src.startsWith('blob:')].join()), 'IMG,true');
    assert.deepEqual(await labels(page, '.sp-top button'), ['Discard']);
    assert.deepEqual(await labels(page, '.sp-actions [aria-label], .sp-actions .sp-share'), ['Save to your phone', 'Your story']);
    // words: typed, then dragged, resized with the wheel and the keys, and edited again with another colour
    await addText(page, 'Hello church');
    let ed = await editor(page);
    assert.deepEqual([ed.overlay.layers.length, ed.overlay.layers[0].text, ed.overlay.layers[0].x, ed.overlay.layers[0].y, ed.overlay.layers[0].colour], [1, 'Hello church', 0.5, 0.5, '#FFFFFF']);
    const at = await framePoint(page);
    await drag(page, at(0.5, 0.5), at(0.5, 0.3));
    ed = await editor(page);
    assert.ok(Math.abs(ed.overlay.layers[0].y - 0.3) < 0.03 && Math.abs(ed.overlay.layers[0].x - 0.5) < 0.03, `dragged up: ${JSON.stringify(ed.overlay.layers[0])}`);
    await page.mouse.move(...at(0.5, 0.3));
    await page.mouse.wheel({ deltaY: -300 });
    const bigger = (await editor(page)).overlay.layers[0].size;
    assert.ok(bigger > ed.overlay.layers[0].size, 'the wheel makes it bigger');
    await page.focus('.sp-layers button');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('-');
    ed = await editor(page);
    assert.ok(ed.overlay.layers[0].x > 0.5 && ed.overlay.layers[0].size < bigger, 'the keys move and shrink it');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.sp-edit-input');
    assert.equal(await page.$eval('.sp-edit-input', (t) => t.value), 'Hello church');
    await page.click('.sp-palette [role=radio]:nth-child(4)');
    await page.click('button[aria-label="Done"]');
    await page.waitForFunction(() => !document.querySelector('.sp-edit-input'));
    assert.equal((await editor(page)).overlay.layers[0].colour, '#FFB400');
    // the pen: two strokes in pink, undo one
    await page.click('.sp-rail button[aria-label="Draw"]');
    await page.waitForSelector('.sp-draw.pen');
    await page.click('.sp-palette [role=radio]:nth-child(3)');
    await drag(page, at(0.2, 0.7), at(0.8, 0.75));
    await drag(page, at(0.2, 0.85), at(0.8, 0.8));
    assert.equal((await editor(page)).overlay.strokes.length, 2);
    await page.click('button[aria-label="Undo"]');
    ed = await editor(page);
    assert.deepEqual([ed.overlay.strokes.length, ed.overlay.strokes[0].colour, ed.overlay.strokes[0].points.length > 3], [1, '#FF3D6E', true]);
    await page.click('button[aria-label="Done"]');
    await page.waitForFunction(() => !document.querySelector('.sp-draw.pen'));
    await shot(page, 'stories-preview');
    await checkAccessibility(page, 'Story preview');
    // save to the phone: a JPEG with the words and the drawing on it
    await page.click('.sp-save');
    await page.waitForFunction(() => window.__clicks?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__clicks), [['life-centre-story.jpg', 'blob:']]);
    // post
    await page.click('.sp-share');
    await page.waitForFunction(() => location.hash === '#/', { timeout: 30000 });
    const sign = calls.find((c) => c.sign);
    assert.deepEqual([sign.sign.kind, sign.sign.contentType, sign.sign.size > 5000, calls.filter((c) => c.sign).length], ['stories', 'image/jpeg', true, 1], 'one picture, words and drawing included');
    const [story] = (await allStories()).filter((s) => s.author === STAFF);
    assert.deepEqual([story.type, story.text, story.parts, story.duration, story.views, story.mediaUrl, story.overlay], ['photo', 'Hello church', [{ start: 0, end: 5 }], 5, 0, 'https://media.test/stories/2026/11/1.jpeg', undefined]);
    await page.waitForFunction(() => document.querySelector('.st-circle button.st-ring')?.getAttribute('aria-label') === 'Your stories, 1 story, new');
    assert.deepEqual(await page.$$eval('.st-circle', (els) => els.map((c) => [c.querySelector('.st-label').textContent, c.querySelector('.st-plus')?.getAttribute('href') ?? null])), [['Your story', '#/stories/new'], ['Samuel', null]], 'the circle plays the story and the + still opens the camera');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('recording: hold the shutter, the ring fills with a mark at every part and the parts build up along the top; sliding up locks it hands-free; it stops by itself at the limit and posts as one file with the words and drawing laid over it', async () => {
    await setPoster(STAFF, true);
    const calls = [];
    const { page, errors, context } = await openAsStaff('/account', STAFF, { setup: fakeMedia(calls) });
    await camera(page, { partSeconds: 2 });
    await camOn(page);
    const [sx, sy] = await centre(page, '.sp-shutter');
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForSelector('.sp-shutter.rec', { timeout: 5000 });
    assert.equal(await page.$eval('.sp-shutter', (b) => b.getAttribute('aria-label')), 'Stop recording');
    let recState = await editor(page);
    assert.deepEqual([recState.micOpen, recState.recorderTracks, recState.throughCanvas, recState.previewAudioTracks], [true, { video: 1, audio: 1 }, true, 0], 'the microphone opens for the recording only; the selfie is recorded as seen (mirrored, cropped)');
    await page.waitForFunction(() => document.querySelectorAll('.sp-part.on').length >= 2, { timeout: 10000 });
    assert.match(await text(page, '.sp-time'), /^0:0[2-9]$/);
    const ring = await page.$eval('.sp-ring .prog', (c) => ({ len: parseFloat(c.getAttribute('stroke-dasharray')), off: parseFloat(c.style.strokeDashoffset) }));
    assert.ok(ring.off > 0 && ring.off < ring.len * 0.9, `the ring is part-way round: ${JSON.stringify(ring)}`);
    assert.equal(await page.$eval('.sp-shutter', (b) => b.classList.contains('locked')), false);
    await shot(page, 'stories-recording');
    // slide up: zooms in while recording, and the level shows
    await page.mouse.move(sx, sy - 120, { steps: 6 });
    recState = await editor(page);
    assert.ok(Math.abs(recState.zoom - Math.exp(0.8)) < 0.02 && recState.digital === recState.zoom, `zoomed by sliding up: ${recState.zoom}`);
    assert.equal(await text(page, '.sp-zoom'), '2.2x');
    assert.equal(await page.$eval('.sp-shutter', (b) => b.classList.contains('locked')), false, 'sliding up does not lock');
    // slide left onto the lock: letting go keeps recording
    await page.mouse.move(sx - 120, sy - 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('.sp-shutter.locked');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual([await page.$eval('.sp-shutter', (b) => b.classList.contains('rec')), (await editor(page)).locked, await page.$eval('.sp-lock', (l) => l.classList.contains('on'))], [true, true, true], 'still recording after letting go');
    await shot(page, 'stories-locked');
    await page.waitForSelector('.story-cam[data-stage=preview]', { timeout: 25000 }); // stopped by itself at 6 parts of 2 seconds
    assert.deepEqual([await page.$eval('.sp-frame .sp-media', (m) => m.tagName), (await page.$$('.sp-parts .sp-part.on')).length], ['VIDEO', 6]);
    assert.equal((await editor(page)).micOpen, false, 'the microphone is off again');
    await page.waitForFunction(() => (document.querySelector('.sp-frame video.sp-media')?.webkitAudioDecodedByteCount || 0) > 0, { timeout: 10000 }); // the recording has sound
    assert.deepEqual(await page.$eval('.sp-frame video.sp-media', (v) => [v.videoWidth > 0, Math.abs(v.videoWidth / v.videoHeight - 9 / 16) < 0.02]), [true, true], 'recorded in the story shape');
    await addText(page, 'Sunday 10am');
    await page.click('.sp-rail button[aria-label="Draw"]');
    const at = await framePoint(page);
    await drag(page, at(0.1, 0.7), at(0.9, 0.72));
    await page.click('button[aria-label="Done"]');
    await page.click('.sp-share');
    await page.waitForFunction(() => location.hash === '#/', { timeout: 40000 });
    const signs = calls.filter((c) => c.sign).map((c) => c.sign);
    assert.deepEqual([signs.length, signs[0].kind, signs[0].contentType.startsWith('video/'), signs[0].contentType.includes(';'), signs[0].size > 1000, signs[1].contentType, calls.find((c) => c.put)?.type === signs[0].contentType], [2, 'stories', true, false, true, 'image/png', true], 'the recording, then the see-through picture of the words and drawing');
    const [story] = await allStories();
    assert.deepEqual([story.type, story.author, story.text, story.parts, story.duration, story.overlay, story.mediaUrl.startsWith('https://media.test/stories/')], ['video', STAFF, 'Sunday 10am', [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 8 }, { start: 8, end: 10 }, { start: 10, end: 12 }], 12, 'https://media.test/stories/2026/11/2.png', true]);
    // the viewer lays that picture over the video
    await page.waitForSelector('.st-circle button.st-ring');
    await page.click('.st-circle button.st-ring');
    await page.waitForSelector('.st-stage');
    assert.deepEqual(await page.$eval('.st-frame', (f) => [!!f.querySelector('video.st-video'), f.querySelector('img.st-overlay')?.getAttribute('src'), f.querySelector('.st-text')?.hidden ?? true]), [true, 'https://media.test/stories/2026/11/2.png', true]);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('uses the camera\'s own zoom where it has one, offers 0.5x when it zooms out below 1x, and focuses where the picture is tapped', async () => {
    await setPoster(STAFF, true);
    const phone = (p) => p.evaluateOnNewDocument(() => { // a phone camera that zooms from 0.5x to 8x and focuses on a point
      window.__applied = [];
      const caps = MediaStreamTrack.prototype.getCapabilities;
      MediaStreamTrack.prototype.getCapabilities = function () { const c = caps.call(this); return this.kind === 'video' ? { ...c, zoom: { min: 0.5, max: 8, step: 0.1 }, focusMode: ['continuous', 'single-shot'], pointsOfInterest: true } : c; };
      MediaStreamTrack.prototype.applyConstraints = function (c) { window.__applied.push(JSON.parse(JSON.stringify(c))); return Promise.resolve(); };
    });
    const { page, errors, context } = await openAsStaff('/account', STAFF, { setup: async (p) => { await fakeMedia()(p); await phone(p); } });
    await camera(page);
    await page.waitForSelector('.sp-zoom-chips button[aria-label^="Zoom 0.5x"]');
    let s = await editor(page);
    assert.deepEqual([s.cameraZooms, s.ultraWide, s.zoom, s.digital, s.lens], [true, true, 1, 1, 'main']);
    assert.deepEqual(await page.$$eval('.sp-zoom-chips button', (bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed')])), [['0.5x', 'false'], ['1x', 'true']]);
    await page.click('.sp-zoom-chips button[aria-label^="Zoom 0.5x"]');
    s = await editor(page);
    assert.deepEqual([s.zoom, s.digital, s.lens], [0.5, 1, 'ultra']);
    assert.deepEqual(await page.$$eval('.sp-zoom-chips button', (bs) => bs.map((b) => b.getAttribute('aria-pressed'))), ['true', 'false']);
    assert.deepEqual((await page.evaluate(() => window.__applied)).at(-1), { advanced: [{ zoom: 0.5 }] }, 'the camera zooms itself');
    assert.equal(await page.$eval('video.sp-cam', (v) => v.style.transform), 'scaleX(-1) scale(1)', 'no digital zoom on top');
    await pinchCamera(page, 50, 300);
    s = await editor(page);
    assert.deepEqual([s.zoom, s.digital, s.lens], [3, 1, 'main'], 'a pinch zooms the camera itself, past 1x');
    assert.deepEqual((await page.evaluate(() => window.__applied)).at(-1), { advanced: [{ zoom: 3 }] });
    await page.click('.sp-zoom-chips button[aria-label="Zoom 1x"]');
    assert.equal((await editor(page)).zoom, 1);
    // a tap on the picture focuses there (the selfie is mirrored, so left and right swap for the camera)
    const box = await (await page.$('.sp-cam-frame')).boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4);
    const focus = (await page.evaluate(() => window.__applied)).at(-1).advanced[0];
    assert.equal(focus.focusMode, 'single-shot');
    assert.ok(Math.abs(focus.pointsOfInterest[0].x - 0.75) < 0.01 && Math.abs(focus.pointsOfInterest[0].y - 0.4) < 0.01, JSON.stringify(focus));
    assert.equal(await page.$eval('.sp-focus', (f) => f.classList.contains('show')), true, 'a ring shows where it focuses');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('VOICE: the shutter is a microphone; a tap records hands-free over a colour (tap the background to change it) or a photo from the phone, up to 10 parts; the preview plays it back and posts it with the words on the picture', async () => {
    await setPoster(STAFF, true);
    const calls = [];
    const { page, errors, context } = await openAsStaff('/account', STAFF, { setup: fakeMedia(calls) });
    await camera(page, { partSeconds: 2 });
    await page.click('.sp-modes [role=radio]::-p-text(VOICE)');
    await page.waitForSelector('.story-cam[data-mode=voice][data-ready]');
    assert.deepEqual([await page.$eval('.sp-shutter', (b) => b.getAttribute('aria-label')), (await page.$$('.sp-parts .sp-part')).length, (await page.$$('.sp-ring .mark')).length, await page.$('video.sp-cam')], ['Record a voice message', 10, 9, null]);
    const before = await page.$eval('.sp-bg', (b) => b.style.background);
    await page.mouse.click(195, 300);
    await page.waitForFunction((b) => document.querySelector('.sp-bg').style.background !== b, {}, before);
    await shot(page, 'stories-voice');
    await checkAccessibility(page, 'Voice mode');
    await choosePicture(page, '#sp-file');
    await page.waitForSelector('.sp-bg img');
    assert.deepEqual([(await editor(page)).micOpen, (await editor(page)).previewAudioTracks], [false, null], 'no microphone until recording');
    await page.click('.sp-shutter');
    await page.waitForSelector('.sp-shutter.rec.locked');
    assert.deepEqual((await editor(page)).recorderTracks, { video: 0, audio: 1 });
    await page.waitForFunction(() => document.querySelectorAll('.sp-part.on').length >= 2 && /0:0[3-9]/.test(document.querySelector('.sp-time')?.textContent || ''), { timeout: 10000 });
    await page.click('.sp-shutter');
    await page.waitForSelector('.story-cam[data-stage=preview]');
    assert.deepEqual(await page.$eval('.sp-frame', (f) => [!!f.querySelector('audio'), f.querySelector('.sp-voice-mark button')?.getAttribute('aria-label'), f.querySelector('img.sp-media') !== null]), [true, 'Play', true]);
    assert.equal((await page.$$('.sp-parts .sp-part.on')).length, 2, 'two parts');
    await page.click('.sp-voice-mark button');
    await page.waitForFunction(() => document.querySelector('.sp-frame audio')?.paused === false, { timeout: 8000 });
    assert.equal(await page.$eval('.sp-voice-mark button', (b) => b.getAttribute('aria-label')), 'Pause');
    await addText(page, 'Prayer');
    await page.click('.sp-share');
    await page.waitForFunction(() => location.hash === '#/', { timeout: 30000 });
    const signs = calls.filter((c) => c.sign).map((c) => c.sign);
    const [story] = await allStories();
    assert.deepEqual([story.type, story.parts.length, story.colours, story.text, story.bgImage, signs.map((s) => s.contentType.split('/')[0])], ['audio', 2, ['#2A1B6B', '#7A3FD6'], 'Prayer', 'https://media.test/stories/2026/11/2.jpeg', ['audio', 'image']]);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('TEXT: swiping the switcher changes mode; a colour with a big cursor, a tap on the background changes the colour, the tick opens the preview, the background can still change there, and it posts as a picture of the words', async () => {
    await setPoster(STAFF, true);
    const calls = [];
    const { page, errors, context } = await openAsStaff('/account', STAFF, { setup: fakeMedia(calls) });
    await camera(page);
    const [mx, my] = await centre(page, '.sp-modes');
    await drag(page, [mx + 80, my], [mx - 80, my]);
    await page.waitForSelector('.story-cam[data-mode=voice][data-ready]');
    await drag(page, [mx + 80, my], [mx - 80, my]);
    await page.waitForSelector('.story-cam[data-mode=text][data-ready]');
    assert.deepEqual(await page.$$eval('.sp-modes [role=radio]', (els) => els.map((b) => b.getAttribute('aria-checked'))), ['false', 'false', 'true']);
    await page.waitForFunction(() => document.activeElement?.classList.contains('sp-text-input'));
    assert.deepEqual([await page.$eval('.sp-shutter', (b) => [b.getAttribute('aria-label'), b.disabled].join()), await page.$('.sp-ring'), await page.$('.sp-parts')], ['Next,true', null, null]);
    const before = await page.$eval('.sp-bg', (b) => b.style.background);
    await page.mouse.click(195, 120);
    await page.waitForFunction((b) => document.querySelector('.sp-bg').style.background !== b, {}, before);
    await page.type('.sp-text-input', 'Service at 10.30');
    assert.equal(await page.$eval('.sp-shutter', (b) => b.disabled), false);
    await shot(page, 'stories-text');
    await checkAccessibility(page, 'Text mode');
    await page.click('.sp-shutter');
    await page.waitForSelector('.story-cam[data-stage=preview]');
    let ed = await editor(page);
    assert.deepEqual([ed.overlay.layers.length, ed.overlay.layers[0].text, ed.colours], [1, 'Service at 10.30', ['#2A1B6B', '#7A3FD6']]);
    await page.click('.sp-rail button[aria-label="More tools"]');
    await page.click('.sp-rail button[aria-label="Background colour"]');
    ed = await editor(page);
    assert.deepEqual(ed.colours, ['#FF6A3D', '#E5326B']);
    await page.click('.sp-share');
    await page.waitForFunction(() => location.hash === '#/', { timeout: 30000 });
    const [story] = await allStories();
    assert.deepEqual([story.type, story.text, story.mediaUrl, story.mediaType, story.colours, story.parts, story.duration, calls.filter((c) => c.sign).length], ['text', 'Service at 10.30', 'https://media.test/stories/2026/11/1.jpeg', 'image/jpeg', ['#FF6A3D', '#E5326B'], [{ start: 0, end: 6 }], 6, 1]);
    await page.waitForSelector('.st-circle button.st-ring');
    await page.click('.st-circle button.st-ring');
    await page.waitForSelector('.st-stage');
    assert.deepEqual(await page.$eval('.st-frame', (f) => [f.querySelector('img.st-photo')?.getAttribute('src'), f.querySelector('img.st-photo')?.getAttribute('alt')]), ['https://media.test/stories/2026/11/1.jpeg', 'Service at 10.30'], 'the viewer shows the picture, with the words for screen readers');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('hands-free records on a tap; the preview asks before discarding; a video from the phone is split into parts; Close goes Home; Account\'s button opens the camera; someone not set up for stories sees why', async () => {
    await setPoster(STAFF, true);
    const calls = [];
    const { page, context } = await openAsStaff('/account', STAFF, { setup: fakeMedia(calls) });
    await waitText(page, 'You have no story up at the moment.');
    await page.evaluate(() => document.querySelector('a.btn[href="#/stories/new"]').click());
    await page.waitForSelector('.story-cam[data-stage=camera][data-mode=story][data-ready]');
    await camera(page, { partSeconds: 2 });
    await camOn(page);
    await page.click('.sp-rail button[aria-label="More tools"]');
    await page.click('.sp-rail button[aria-label="Hands-free"]');
    assert.equal(await page.$eval('.sp-shutter', (b) => b.getAttribute('aria-label')), 'Record a video');
    await page.click('.sp-shutter');
    await page.waitForSelector('.sp-shutter.rec.locked');
    await new Promise((r) => setTimeout(r, 1500));
    await page.click('.sp-shutter');
    await page.waitForSelector('.story-cam[data-stage=preview]');
    await page.click('button[aria-label="Discard"]');
    await page.waitForSelector('.sp-dialog');
    await page.click('.sp-dialog button::-p-text(Keep)');
    assert.deepEqual([await page.$('.sp-dialog'), await page.$eval('.story-cam', (s) => s.dataset.stage)], [null, 'preview']);
    await page.click('button[aria-label="Discard"]');
    await page.click('.sp-dialog button::-p-text(Discard)');
    await page.waitForSelector('.story-cam[data-stage=camera][data-mode=story][data-ready]');
    // a video from the phone (the fake camera's own recording, 9.5 seconds): 5 parts of 2 seconds
    await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'clip.webm', { type: 'video/webm' }));
      const input = document.querySelector('#sp-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, files.get(V).body.toString('base64'));
    await page.waitForSelector('.story-cam[data-stage=preview]', { timeout: 20000 });
    assert.deepEqual([await page.$eval('.sp-frame .sp-media', (m) => m.tagName), (await page.$$('.sp-parts .sp-part.on')).length, (await editor(page)).draft.parts.at(-1).start, (await editor(page)).draft.parts.at(-1).end >= 9], ['VIDEO', 5, 8, true]);
    await page.click('button[aria-label="Discard"]');
    await page.click('.sp-dialog button::-p-text(Discard)');
    await page.waitForSelector('.story-cam[data-stage=camera][data-ready]');
    await page.click('button[aria-label="Close"]');
    await page.waitForFunction(() => location.hash === '#/');
    await context.close();
    const other = await openAsStaff('/stories/new', LEADER);
    await waitText(other.page, 'Not set up for stories');
    await other.context.close();
  });

  it('Account: a Post a story button, the poster\'s stories with their view counts and Delete, and the name and photo shown on stories', async () => {
    await setPoster(STAFF, true);
    await seedStory('mine', { author: STAFF, authorName: 'Staff Member', views: 3 });
    const calls = [];
    const { page, errors, context } = await openAsStaff('/account', STAFF, { setup: fakeMedia(calls) });
    await page.waitForSelector('a.btn[href="#/stories/new"]');
    try { await waitText(page, '3 views', '.acct-stories'); } catch (e) {
      throw new Error(`no story list on Account.\nPage: ${await page.$eval('#main', (m) => m.innerText.replace(/\n+/g, ' | ').slice(0, 900))}\nErrors: ${errors.join(' | ')}`);
    }
    assert.match(await text(page, '.acct-stories'), /Video.*3 parts · 0:09 · 3 views/s);
    await new Promise((r) => setTimeout(r, 400)); // the page settles after its lists load
    await page.evaluate(() => document.querySelector('#acct-name').focus());
    await page.keyboard.type('Pastor Sam');
    const press = (selector, label) => page.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.trim() === text); b.scrollIntoView({ block: 'center' }); b.click(); }, selector, label); // no handle to go stale, and clear of the floating tab bar
    await press('button.btn.primary', 'Save');
    await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some((s) => s.textContent.includes('Saved.')), { timeout: 15000 });
    assert.equal((await readDoc('staff', STAFF)).displayName, 'Pastor Sam');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('lc:v1:session'))).displayName, 'Pastor Sam');
    await press('button[aria-label="Delete this video story"]');
    await waitText(page, 'You have no story up at the moment.');
    assert.equal(await readDoc('stories', 'mine'), undefined);
    // a story posted now carries the new name
    await goto(page, '/stories/new');
    await page.waitForSelector('.story-cam[data-stage=camera][data-ready]');
    await page.click('.sp-modes [role=radio]::-p-text(TEXT)');
    await page.waitForSelector('.sp-text-input');
    await page.type('.sp-text-input', 'Named');
    await page.click('.sp-shutter');
    await page.waitForSelector('.story-cam[data-stage=preview]');
    await page.click('.sp-share');
    await page.waitForFunction(() => location.hash === '#/', { timeout: 20000 });
    assert.equal((await allStories())[0].authorName, 'Pastor Sam');
    await context.close();
  });
});

describe('Home greeting', () => {
  const HOUR = 3600000;
  const SG = 'Asia/Singapore';
  // Opens the page with its clock moved to the given Singapore time today; the clock keeps ticking from there.
  const clockAt = (hour, minute = 0, second = 0) => (p) => p.evaluateOnNewDocument((start) => {
    const real = Date.now; const shift = start - real(); Date.now = () => real() + shift;
  }, dayStart(TODAY) + ((hour * 60 + minute) * 60 + second) * 1000);
  // The booking system answers a signed-in member with no bookings, so a test session is not thrown away.
  const noBookings = async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (req) => (req.url().startsWith('https://script.google.com/') ? req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, upcoming: [], past: [] }) }) : req.continue()));
  };
  const asMember = (name) => async (p) => { // signed in for bookings on this phone before the page opens
    await p.evaluateOnNewDocument((n) => localStorage.setItem('lc:v1:booking-session', JSON.stringify({ token: 'a'.repeat(64), name: n, email: 'member@example.org' })), name);
    await noBookings(p);
  };
  const both = (...steps) => async (p) => { for (const step of steps) await step(p); };
  const memberIn = (page, name) => page.evaluate(async (n) => { const m = await import('/app/js/booking-api.js'); m.setSession({ token: 'b'.repeat(64), name: n, email: 'member@example.org' }); }, name);
  const memberOut = (page) => page.evaluate(async () => { const m = await import('/app/js/booking-api.js'); m.clearSession(); });
  const googleOut = (page) => page.evaluate(async () => { const { getAuthTools } = await import('/app/js/firebase.js'); const { signOut } = await import('firebase/auth'); const { auth } = await getAuthTools(); await signOut(auth); });
  const lines = (page) => page.$eval('.greeting .lines', (el) => ({
    light: el.querySelector('.hello').textContent, bold: el.querySelector('h1 .name').textContent, date: el.querySelector('.date').textContent,
    sr: el.querySelector('h1 .sr').textContent, hidden: ['.hello', 'h1 .name', '.date'].map((s) => el.querySelector(s).getAttribute('aria-hidden')), today: /\bToday\b/.test(el.textContent),
  }));
  const boldIs = (page, value) => page.waitForFunction((v) => document.querySelector('.greeting h1 .name')?.textContent === v, { timeout: 8000 }, value);
  const noon = dayStart(TODAY) + 12 * HOUR;
  const longDate = `${new Intl.DateTimeFormat('en-GB', { timeZone: SG, weekday: 'long' }).format(noon)}, ${new Intl.DateTimeFormat('en-GB', { timeZone: SG, day: 'numeric', month: 'long' }).format(noon)}`; // "Tuesday, 3 November"
  const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: SG, weekday: 'short', month: 'short', day: 'numeric' }).format(noon); // "Tue, Nov 3"

  it('says Good morning from 5am, Good afternoon from noon and Good evening from 6pm, by the Singapore clock', async () => {
    for (const [hour, minute, expected] of [[5, 0, 'morning'], [11, 59, 'morning'], [12, 0, 'afternoon'], [17, 59, 'afternoon'], [18, 0, 'evening'], [23, 30, 'evening'], [0, 10, 'evening'], [4, 59, 'evening']]) {
      const { page, context } = await open('#/', { setup: clockAt(hour, minute) });
      const l = await lines(page);
      assert.deepEqual([l.light, l.bold, l.date, l.today], ['Good', expected, shortDate, false], `at ${hour}:${String(minute).padStart(2, '0')}`);
      await context.close();
    }
  });
  it('greets a signed-in member by first name on the bold line, then the date, and reads as one sentence', async () => {
    const { page, errors, context } = await open('#/', { setup: both(clockAt(9), asMember('Theersha test')) });
    const l = await lines(page);
    assert.deepEqual([l.light, l.bold, l.date, l.sr, l.hidden, l.today], ['Good morning', 'Theersha', shortDate, `Good morning, Theersha. ${longDate}`, ['true', 'true', 'true'], false]);
    await shot(page, 'home-greeting-member');
    await checkAccessibility(page, 'Home greeting, signed in');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('signed out, splits the greeting over the two lines, "Good" then "morning", before the date', async () => {
    const { page, context } = await open('#/', { setup: clockAt(9) });
    const l = await lines(page);
    assert.deepEqual([l.light, l.bold, l.date, l.sr], ['Good', 'morning', shortDate, `Good morning. ${longDate}`]);
    await shot(page, 'home-greeting-signed-out');
    await context.close();
  });
  it('uses the first name of the Google sign-in when there is no member sign-in, the member name when there are both, and follows sign-outs at once', async () => {
    const { page, context } = await open('#/staff', { setup: both(clockAt(15), noBookings) });
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF, 'Samuel Tan');
    await goto(page, '/');
    await boldIs(page, 'Samuel');
    assert.equal((await lines(page)).light, 'Good afternoon');
    await memberIn(page, 'Theersha test');
    await boldIs(page, 'Theersha');
    await memberOut(page);
    await boldIs(page, 'Samuel');
    await googleOut(page);
    await boldIs(page, 'afternoon');
    assert.equal((await lines(page)).light, 'Good');
    await context.close();
  });
  it('changes straight away when a member signs in or out, with no reload', async () => {
    const { page, context } = await open('#/', { setup: both(clockAt(20), noBookings) });
    assert.deepEqual([(await lines(page)).light, (await lines(page)).bold], ['Good', 'evening']);
    await memberIn(page, 'Grace Lim');
    await boldIs(page, 'Grace');
    assert.equal((await lines(page)).light, 'Good evening');
    await memberOut(page);
    await boldIs(page, 'evening');
    assert.equal((await lines(page)).light, 'Good');
    await context.close();
  });
  it('moves on from Good morning to Good afternoon at noon while the app stays open', async () => {
    const { page, context } = await open('#/', { setup: both(clockAt(11, 59, 58), asMember('Theersha test')) });
    assert.equal((await lines(page)).light, 'Good morning');
    await page.waitForFunction(() => document.querySelector('.greeting .hello').textContent === 'Good afternoon', { timeout: 8000 });
    assert.equal((await lines(page)).sr, `Good afternoon, Theersha. ${longDate}`);
    await context.close();
  });
  it('keeps a very long first name on one line, cut short with an ellipsis, and reads the whole word', async () => {
    const { page, context } = await open('#/', { setup: both(clockAt(9), asMember('Maximilianotheodorusbartholomew Lim')) });
    const box = await page.$eval('.greeting h1 .name', (el) => {
      const cs = getComputedStyle(el);
      return { text: el.textContent, clipped: el.scrollWidth > el.clientWidth, overflow: cs.textOverflow, wrap: cs.whiteSpace, lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)), inside: el.getBoundingClientRect().right <= innerWidth };
    });
    assert.deepEqual(box, { text: 'Maximilianotheodorusbartholomew', clipped: true, overflow: 'ellipsis', wrap: 'nowrap', lines: 1, inside: true });
    assert.equal((await lines(page)).sr, `Good morning, Maximilianotheodorusbartholomew. ${longDate}`);
    await context.close();
  });
});

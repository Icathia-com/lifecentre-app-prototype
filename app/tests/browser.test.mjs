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
    label: a.getAttribute('aria-label'), href: a.getAttribute('href'), route: a.dataset.route, soon: a.classList.contains('tab-soon'),
    icon: shown('.ic-facilities') && !shown('.ic-contact') ? 'facilities' : shown('.ic-contact') && !shown('.ic-facilities') ? 'contact' : 'both or neither',
    soonLabelShown: shown('.soon'),
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
    assert.equal((await page.$$('.days .col')).length, 15);
    assert.equal((await page.$$('.tile')).length, 3); // the draft and the far-off conference are not in the next two weeks
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
  it('gives each calendar tile a Done, Up next or Later state, with times on the left', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile');
    assert.match(await text(page, '.month'), /^[A-Z][a-z]+/);
    assert.deepEqual(await page.$$eval('.rail-row span', (els) => els.map((e) => e.textContent)), ['12:30 PM', '7:00 PM', '7:30 PM']);
    assert.deepEqual(await page.$$eval('.tile', (els) => els.map((e) => e.className.replace('tile ', ''))), ['next', 'later', 'later']);
    assert.equal(await page.$eval('.col-head.today .ring', (r) => r.style.getPropertyValue('--c')), '#E59A00');
    await context.close();
  });
  it('only gives a time row room when something is on it in the three visible days', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile');
    await page.waitForFunction(() => [...document.querySelectorAll('.rail-row')].every((e) => e.offsetHeight === 0)); // yesterday, today, tomorrow: nothing
    await page.$eval('.days', (d) => { d.style.scrollSnapType = 'none'; d.scrollLeft = d.clientWidth / 3 * 2; });
    await page.waitForFunction(() => [...document.querySelectorAll('.rail-row')].some((e) => e.offsetHeight === 64));
    await context.close();
  });
  it('opens the event page when a tile is chosen', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile');
    await page.$$eval('.tile', (tiles) => tiles[0].click());
    await waitTitle(page, 'Cell group night');
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'events');
    await context.close();
  });
  it('says so plainly when nothing is scheduled', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { for (const id of ['e1', 'e2', 'e4']) await setDoc(doc(ctx.firestore(), 'events', id), { title: 'x', start: at(40, 9), location: 'yishun', type: 'special', published: true, updatedBy: STAFF }); });
    const { page, context } = await open();
    await waitText(page, 'Nothing scheduled');
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
    await waitText(page, 'Coming soon');
    await context.close();
  });
  it('lists Facilities Booking Request in the + menu', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.tile'); // let the calendar finish drawing first
    await page.$eval('.fab', (b) => b.scrollIntoView({ block: 'center' })); // it sits at the bottom of the calendar card
    await page.click('.fab');
    assert.match(await text(page, '#fab-menu a'), /Facilities Booking Request/);
    assert.equal(await page.$eval('#fab-menu a', (a) => a.getAttribute('href')), '#/booking');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open();
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.tile');
    await page.waitForSelector('.banner');
    await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running')); // colours are checked after the transitions end
    await checkAccessibility(page, 'Home');
    await context.close();
  });
});

describe('the bottom bar', () => {
  it('has five tabs: Events replaces Announcements, and Giving, Watch and Contact us are marked coming soon', async () => {
    const { page, context } = await open();
    assert.deepEqual(await page.$$eval('.tabbar .tab', (els) => els.map((e) => e.getAttribute('aria-label'))), ['Home', 'Events', 'Giving, coming soon', 'Watch, coming soon', 'Contact us, coming soon']);
    assert.equal((await page.$$('.tab-soon .soon:not([hidden])')).length, 3);
    await page.click('.tab[data-route="giving"]');
    await waitText(page, 'Coming soon', '#main');
    assert.equal(await pageTitle(page), 'Giving');
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
    assert.deepEqual(await fifthTab(page), { label: 'Contact us, coming soon', href: '#/contact', route: 'contact', soon: true, icon: 'contact', soonLabelShown: true });
    for (const email of [STAFF, LEADER, ADMIN]) {
      await signIn(page, email);
      await page.waitForFunction(() => document.querySelector('#tab-fifth').dataset.route === 'booking', { timeout: 15000 });
      assert.deepEqual(await fifthTab(page), { label: 'Facilities Booking', href: '#/booking', route: 'booking', soon: false, icon: 'facilities', soonLabelShown: false }, email);
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
    await page.waitForSelector('.tile');
    await page.click('.tab[data-route="events"]');
    await page.waitForSelector('.ev-row');
    await page.click('.tab[data-route="home"]');
    await page.waitForSelector('.tile');
    await page.setOfflineMode(true);
    await page.click('.tab[data-route="events"]');
    await page.waitForSelector('.ev-row', { timeout: 20000 });
    await waitText(page, 'saved on this phone');
    assert.deepEqual(await page.$$eval('.ev-row .ev-title', (els) => els.map((e) => e.textContent)), ['Cell group night', 'Sample lunch', 'Youth night']);
    await page.click('.tab[data-route="home"]');
    await page.waitForSelector('.verse-card blockquote', { timeout: 20000 });
    await page.waitForSelector('.tile');
    await waitText(page, 'saved on this phone');
    assert.match(await text(page, '.verse-card blockquote'), /The LORD is my shepherd/);
    assert.equal((await page.$$('.tile')).length, 3);
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
    await page.waitForSelector('.tile');
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.banner'); // it pushes the calendar down when it arrives, so wait before measuring
    const drag = async (from, to) => {
      await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
    };
    assert.equal(await page.$eval('#main', (m) => m.scrollTop), 0);
    await drag([8, 500], [8, 200]); // from the empty gutter beside the cards
    assert.ok(await page.$eval('#main', (m) => m.scrollTop) > 100, 'screen did not scroll');

    await page.evaluate(() => document.querySelector('.col-head:not(.today)').scrollIntoView({ block: 'center' })); // clear of the tab bar
    await new Promise((r) => setTimeout(r, 300));
    const head = await (await page.$('.col-head:not(.today)')).boundingBox();
    assert.ok(head.y > 80 && head.y < 400, `calendar header is not clear of the tab bar (y=${head.y})`);
    const firstColumn = () => page.$eval('.days', (d) => Math.round(d.scrollLeft / (d.clientWidth / 3)));
    assert.equal(await firstColumn(), 0);
    // Drag left by about two columns, starting on a day header. A click there would scroll back instead.
    await drag([head.x + 80, head.y + 20], [head.x - 100, head.y + 20]);
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(await firstColumn() >= 2, `days did not scroll (first column ${await firstColumn()})`);
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
    await waitText(page, 'Already booked: 14:00–16:00', '#main');
    assert.match(await text(page, '#main'), /Requested: 18:00–19:00/);
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
    await page.select('[name="start"]', '16:00');
    await page.select('[name="end"]', '17:00');
    await waitText(page, 'Already booked: 14:00–16:00', '#main');
    assert.equal(await page.$eval('#bk-submit', (b) => b.disabled), false);
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

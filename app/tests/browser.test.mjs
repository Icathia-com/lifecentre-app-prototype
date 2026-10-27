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
    await setDoc(doc(db, 'verses', TODAY), { reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.', translation: 'KJV', ...by });
    await setDoc(doc(db, 'announcements', 'pin'), { title: 'Conference news', body: 'Registration is open.', pinned: true, published: true, publishedAt: at(0, 8), linkUrl: 'https://example.org/register', linkLabel: 'Register', ...by });
    await setDoc(doc(db, 'announcements', 'plain'), { title: 'Cell groups', body: 'Join one this month.', pinned: false, published: true, publishedAt: at(-1, 18), sample: true, ...by });
    await setDoc(doc(db, 'announcements', 'draft'), { title: 'Secret draft', body: '', pinned: false, published: false, publishedAt: at(0, 9), ...by });
    await setDoc(doc(db, 'events', 'e1'), { title: 'Cell group night', start: at(2, 19, 30), end: at(2, 21), location: 'Main hall', published: true, ...by });
    await setDoc(doc(db, 'events', 'e2'), { title: 'Sample lunch', start: at(4, 12, 30), published: true, sample: true, ...by });
    await setDoc(doc(db, 'events', 'e3'), { title: 'Secret draft event', start: at(2, 10), published: false, ...by });
  });
});

// Each test gets its own browser profile, so sign-in state and saved content never leak between tests.
async function open(hash = '#/', { width = 390, height = 844, setup } = {}) {
  const context = await browser.createBrowserContext();
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
}

describe('Home', () => {
  it('shows the verse, the pinned banner and the church calendar from the database', async () => {
    const { page, errors, context } = await open();
    await waitText(page, 'Psalm 23:1');
    assert.match(await text(page, '.verse blockquote'), /The LORD is my shepherd/);
    assert.equal(await page.$('.verse .badge'), null); // not sample
    assert.match(await text(page, 'a.pinned'), /Conference news/);
    assert.equal((await page.$$('.strip .day')).length, 14);
    assert.equal((await page.$$('.strip .day.has-events')).length, 2);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Secret draft/);
    await shot(page, 'home');
    assert.deepEqual(errors, []);
    await context.close();
  });
  it('shows an event, its sample label and the add-to-calendar links when its day is chosen', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.strip .day.has-events');
    const days = await page.$$('.strip .day.has-events');
    await days[0].click();
    await waitText(page, 'Cell group night');
    assert.match(await text(page, '.events'), /7:30pm – 9:00pm/);
    assert.match(await text(page, '.events'), /Main hall/);
    assert.match(await page.$eval('.events a[href^="https://calendar.google.com"]', (a) => a.href), /action=TEMPLATE/);
    assert.match(await page.$eval('.events a[download]', (a) => a.href), /^data:text\/calendar/);
    await days[1].click();
    await waitText(page, 'Sample lunch');
    assert.match(await text(page, '.events .badge'), /Sample/);
    await shot(page, 'home-event');
    await context.close();
  });
  it('shows an empty day plainly', async () => {
    const { page, context } = await open();
    await page.waitForSelector('.strip .day.has-events');
    await waitText(page, 'Nothing scheduled');
    await context.close();
  });
  it('has no accessibility violations', async () => {
    const { page, context } = await open();
    await waitText(page, 'Psalm 23:1');
    await page.waitForSelector('.strip .day.has-events');
    await checkAccessibility(page, 'Home');
    await context.close();
  });
});

describe('Announcements', () => {
  it('lists published announcements, pinned first, with sample labels and https links only', async () => {
    const { page, errors, context } = await open();
    await page.click('.tab[data-route="announcements"]');
    await page.waitForSelector('article');
    const titles = await page.$$eval('article h2', (els) => els.map((e) => e.textContent));
    assert.deepEqual(titles, ['Conference news', 'Cell groups']);
    assert.equal(await page.$eval('article.pinned a.link', (a) => a.getAttribute('rel')), 'noopener');
    assert.match(await text(page, 'article.announcement .badge'), /Sample/);
    assert.equal(await page.$eval('.tab[aria-current="page"]', (a) => a.dataset.route), 'announcements');
    await shot(page, 'announcements');
    assert.deepEqual(errors, []);
    await checkAccessibility(page, 'Announcements');
    await context.close();
  });
  it('shows an empty state when there are none', async () => {
    await env.clearFirestore();
    const { page, context } = await open('#/announcements');
    await waitText(page, 'No announcements yet.');
    await context.close();
  });
});

describe('when the database cannot be reached', () => {
  it('shows what was saved on the phone', async () => {
    // Visit both screens online first, so their code and content are loaded and saved.
    const { page, context } = await open('#/');
    await waitText(page, 'Psalm 23:1');
    await page.click('.tab[data-route="announcements"]');
    await page.waitForSelector('article');
    await page.setOfflineMode(true);
    await page.click('.tab[data-route="home"]');
    await waitText(page, 'saved on this phone');
    assert.match(await text(page, '.verse blockquote'), /The LORD is my shepherd/);
    await page.click('.tab[data-route="announcements"]');
    await page.waitForSelector('article');
    await waitText(page, 'saved on this phone');
    assert.deepEqual(await page.$$eval('article h2', (els) => els.map((e) => e.textContent)), ['Conference news', 'Cell groups']);
    await context.close();
  });
  it('falls back to labelled sample content on a first visit', async () => {
    const { page, context } = await open('#/announcements', {
      setup: async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (new URL(r.url()).port === '8080' ? r.abort() : r.continue())); },
    });
    await waitText(page, 'sample content', '[role=status]');
    assert.ok((await page.$$('article .badge')).length >= 3);
    await shot(page, 'announcements-offline');
    await page.click('.tab[data-route="home"]');
    await page.waitForSelector('.strip .day.has-events', { timeout: 15000 });
    await (await page.$('.strip .day.has-events')).click();
    await waitText(page, 'Sample', '.events');
    await context.close();
  });
});

describe('mouse drag scrolling', () => {
  it('scrolls the screen and the day strip, and does not click what was dragged', async () => {
    const { page, context } = await open('#/', { width: 390, height: 560 });
    await page.waitForSelector('.strip .day.has-events');
    await waitText(page, 'Psalm 23:1');
    const drag = async (from, to) => {
      await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
    };
    assert.equal(await page.$eval('#main', (m) => m.scrollTop), 0);
    await drag([8, 500], [8, 200]); // from the empty gutter beside the cards
    assert.ok(await page.$eval('#main', (m) => m.scrollTop) > 100, 'screen did not scroll');

    const box = await (await page.$('.strip')).boundingBox();
    assert.ok(box.y > 0 && box.y < 500, 'day strip is not on screen');
    const before = await page.$eval('.strip', (s) => s.scrollLeft);
    const selectedBefore = await page.$eval('.strip [aria-pressed="true"]', (b) => b.textContent);
    await drag([box.x + 250, box.y + 30], [box.x + 40, box.y + 30]);
    assert.ok(await page.$eval('.strip', (s) => s.scrollLeft) > before + 100, 'strip did not scroll');
    assert.equal(await page.$eval('.strip [aria-pressed="true"]', (b) => b.textContent), selectedBefore, 'drag ended in a click');
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
    await signIn(page, 'visitor@example.com');
    await waitText(page, 'visitor@example.com is not on the staff list.');
    assert.equal(await page.$('form'), null);
    await page.click('button::-p-text(Sign out)');
    await waitText(page, 'Sign in with Google');
    await context.close();
  });
  it('lets staff post, edit and delete an announcement, which the public then sees', async () => {
    const { page, errors, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    assert.equal(await page.$('button::-p-text(Staff)'), null, 'staff should not see the Staff section'); // exact "Staff" button
    await waitText(page, 'Secret draft'); // staff see drafts

    await page.type('#announcements-title', 'Youth night moved');
    await page.type('#announcements-body', 'Now at 7pm.');
    await page.click('form button[type=submit]');
    await waitText(page, 'Saved.');
    await waitText(page, 'Youth night moved', '.items');
    await shot(page, 'staff-announcements');

    const viewer = await open('#/announcements');
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
  it('lets staff schedule a verse and post an event', async () => {
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
    await page.waitForSelector('#events-title');
    await page.type('#events-title', 'Staff-posted event');
    await page.$eval('#events-start', (el, v) => { el.value = v; }, `${addDays(TODAY, 3)}T19:30`);
    await page.click('form button[type=submit]');
    await waitText(page, 'Staff-posted event', '.items');

    const viewer = await open('#/');
    await viewer.page.waitForSelector('.strip .day.has-events');
    const days = await viewer.page.$$('.strip .day');
    await days[3].click();
    await waitText(viewer.page, 'Staff-posted event');
    await viewer.context.close();
    await context.close();
  });
  it('stops staff dates being saved with an end before the start', async () => {
    const { page, context } = await open('#/staff');
    await waitText(page, 'Sign in with Google');
    await signIn(page, STAFF);
    await waitText(page, `Signed in as ${STAFF}`);
    await page.click('button[aria-pressed]::-p-text(Events)');
    await page.waitForSelector('#events-title');
    await page.type('#events-title', 'Backwards');
    await page.$eval('#events-start', (el, v) => { el.value = v; }, `${addDays(TODAY, 3)}T19:30`);
    await page.$eval('#events-end', (el, v) => { el.value = v; }, `${addDays(TODAY, 3)}T18:00`);
    await page.click('form button[type=submit]');
    await waitText(page, 'The end must be after the start.', '[role=status]');
    await context.close();
  });
  it('lets an admin manage the staff list, but not remove themselves', async () => {
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
    assert.equal(await page.$eval(`button[aria-label="Delete ${ADMIN}"]`, (b) => b.disabled), true);
    await shot(page, 'staff-admin');
    await page.click('button[aria-label="Delete New Leader"]');
    await page.waitForFunction(() => !document.querySelector('.items').innerText.includes('New Leader'));
    await context.close();
  });
});

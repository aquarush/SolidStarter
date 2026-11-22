// Browser end-to-end test: drives the built web app in headless Chrome through a full
// campaign lifecycle on the in-browser mock chain.
//
//   npm run build && npm run e2e
//
// The test serves dist/ itself with the production `_headers` (CSP etc.) applied, unless APP_URL is set.
// CHROME_PATH selects the browser (default /usr/bin/google-chrome).
//
// Scenario A: launch -> Alice pledges -> Bob pledges -> Alice withdraws -> Bob tops up -> creator claims.
// Scenario B: launch -> Carol pledges -> deadline passes -> finalize (fails) -> Carol refunds.
import puppeteer from 'puppeteer-core';
import { serveDist } from './serve-dist.mjs';

const server = process.env.APP_URL ? null : await serveDist();
const URL = process.env.APP_URL ?? server.url;
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const TIMEOUT = 120_000;

const log = (msg) => console.log(`  • ${msg}`);
let failures = 0;
const check = (cond, msg) => {
  if (cond) log(`ok  ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ FAIL ${msg}`);
  }
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.setDefaultTimeout(TIMEOUT);
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
// CSP violations surface as console errors ("Refused to ..."), so the check below also covers the policy.

async function clickButton(text) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith(t) && !b.disabled),
    {},
    text,
  );
  await page.evaluate((t) => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t) && !b.disabled).click();
  }, text);
}

async function persona(name) {
  await page.evaluate((n) => {
    [...document.querySelectorAll('.persona')].find((b) => b.querySelector('strong').textContent === n).click();
  }, name);
  await page.waitForFunction((n) => document.querySelector('.persona.active strong')?.textContent === n, {}, name);
  // On a campaign page, wait until the actions panel has re-read this persona's pledge.
  if (await page.$('.campaign')) {
    await page.waitForFunction((n) => document.querySelector('.campaign .card p.small')?.innerText.includes(`Acting as ${n}`), {}, name);
  }
}

async function waitText(text) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), {}, text);
}

async function notice() {
  await page.waitForSelector('.action-notice');
  return page.$eval('.action-notice', (n) => n.textContent.trim());
}

async function act(label) {
  await clickButton(label);
  await page.waitForFunction(() => !document.body.innerText.includes('Building, checking and broadcasting'));
  return notice();
}

async function pledge(amount) {
  await page.waitForSelector('input[placeholder^="Amount in BCH"]');
  await page.$eval('input[placeholder^="Amount in BCH"]', (el) => { el.value = ''; });
  await page.type('input[placeholder^="Amount in BCH"]', amount);
  return act('Pledge');
}

async function launch(title, goal, min, days) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.persona');
  await persona('Creator');
  const set = async (selector, value) => {
    await page.$eval(selector, (el) => { el.value = ''; });
    await page.type(selector, value);
  };
  await set('.form label:first-of-type input', title);
  await set('.form .row:nth-of-type(1) label:nth-child(1) input', goal);
  await set('.form .row:nth-of-type(1) label:nth-child(2) input', min);
  await set('.form .row:nth-of-type(2) label:nth-child(1) input', days);
  await clickButton('Launch campaign');
  await page.waitForSelector('.campaign-head h1');
  return page.$eval('.campaign-head h1', (h) => h.textContent);
}

const raised = () => page.$eval('.stats strong', (s) => s.textContent);
const phase = () => page.$eval('.badge', (s) => s.textContent);

try {
  console.log('Scenario A: successful campaign');
  const title = await launch('E2E group gift', '0.0005', '0.00001', '3');
  check(title === 'E2E group gift', `campaign page shows on-chain title "${title}"`);
  check((await phase()) === 'Funding', 'phase is Funding');

  await persona('Alice');
  check(/confirmed/.test(await pledge('0.0002')), 'Alice pledges 0.0002 BCH');
  await persona('Bob');
  check(/confirmed/.test(await pledge('0.0001')), 'Bob pledges 0.0001 BCH');
  check((await raised()) === '0.0003 BCH', `raised shows 0.0003 BCH (${await raised()})`);

  await persona('Alice');
  check(/confirmed/.test(await act('Withdraw my pledge')), 'Alice withdraws her pledge');
  check((await raised()) === '0.0001 BCH', `raised drops to 0.0001 BCH (${await raised()})`);

  await persona('Carol');
  const carolCanClaim = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('Claim')));
  check(!carolCanClaim, 'non-creator sees no Claim button');

  await persona('Bob');
  check(/confirmed/.test(await pledge('0.0004')), 'Bob tops up to reach the goal');
  await persona('Creator');
  check(/confirmed/.test(await act('Claim')), 'Creator claims the pot');
  check((await phase()) === 'Succeeded', 'phase is Succeeded');
  await waitText('Funded and paid out');
  check(true, 'UI reports payout to beneficiary');
  const activity = await page.$eval('.activity', (a) => a.innerText);
  check(/Claimed/.test(activity) && /Withdrawn/.test(activity), 'activity feed lists Withdrawn and Claimed events');

  console.log('Scenario B: failed campaign with refund');
  await launch('E2E failing campaign', '1', '0.00001', '1');
  await persona('Carol');
  check(/confirmed/.test(await pledge('0.0003')), 'Carol pledges 0.0003 BCH');
  check(/confirmed/.test(await act('Jump past deadline')), 'demo clock jumps past deadline');
  check(/confirmed/.test(await act('Finalize campaign')), 'anyone can finalize after the deadline');
  check((await phase()) === 'Failed / cancelled', 'phase is Failed');
  check(/confirmed/.test(await act('Reclaim my')), 'Carol reclaims her pledge');
  check((await raised()) === '0 BCH', 'raised back to 0');
} catch (error) {
  failures += 1;
  console.error('  ✗ ERROR', error.message);
  await page.screenshot({ path: 'e2e/failure.png', fullPage: true }).catch(() => undefined);
} finally {
  const relevant = consoleErrors.filter((e) => !/favicon/.test(e));
  check(relevant.length === 0, `no uncaught page errors${relevant.length ? `: ${relevant.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  server?.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);

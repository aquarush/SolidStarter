// Live-network smoke test (read-only, needs internet, no funds):
// switch to Chipnet, create an encrypted wallet, lock it, unlock it with the password, and confirm the app
// reaches the public Electrum server under the production CSP and reports a balance.
//
//   npm run build && node e2e/live-wallet.mjs
//   APP_URL=https://solidstarter.pages.dev/ node e2e/live-wallet.mjs   # against a deployed site
import puppeteer from 'puppeteer-core';
import { serveDist } from './serve-dist.mjs';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const server = process.env.APP_URL ? { url: process.env.APP_URL, close() {} } : await serveDist(4181);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.setDefaultTimeout(90_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failures = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? '•' : '✗ FAIL'} ${msg}`);
  if (!cond) failures += 1;
};
const click = (text) =>
  page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t).click(), text);

try {
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.network-switch');
  await click('Chipnet');
  await page.waitForFunction(() => document.body.innerText.includes('No chipnet wallet'));
  check(true, 'chipnet session starts with no wallet');

  await click('Create wallet');
  await page.type('input[placeholder^="New password"]', 'correct horse battery');
  await click('Create & encrypt');
  await page.waitForSelector('.wallet-line code');
  const address = await page.$eval('.wallet-line code', (c) => c.getAttribute('title'));
  check(address.startsWith('bchtest:q'), `wallet created: ${address}`);

  await page.waitForFunction(() => /BCH$|balance unavailable/.test(document.querySelector('.balance')?.textContent ?? ''));
  const balance = await page.$eval('.balance', (b) => b.textContent);
  check(balance === '0 BCH', `balance fetched from chipnet Electrum: ${balance}`);

  const stored = await page.evaluate(() => localStorage.getItem('solidstarter.wallet.v1.chipnet'));
  check(stored && !/[0-9a-f]{64}/.test(stored) && JSON.parse(stored).ciphertext, 'only ciphertext is stored');

  await click('Lock');
  await page.waitForSelector('input[placeholder="Password"]');
  await page.type('input[placeholder="Password"]', 'wrong password!!');
  await click('Unlock');
  await page.waitForSelector('.error-text');
  check((await page.$eval('.error-text', (e) => e.textContent)) === 'Wrong password.', 'wrong password rejected');

  await page.$eval('input[placeholder="Password"]', (el) => { el.value = ''; });
  await page.type('input[placeholder="Password"]', 'correct horse battery');
  await click('Unlock');
  await page.waitForSelector('.wallet-line code');
  const again = await page.$eval('.wallet-line code', (c) => c.getAttribute('title'));
  check(again === address, 'unlock restores the same wallet');
} catch (error) {
  failures += 1;
  console.error('  ✗ ERROR', error.message);
} finally {
  check(errors.length === 0, `no page errors or CSP violations${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nLive wallet checks passed');
process.exit(failures ? 1 : 0);

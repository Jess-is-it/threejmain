// Host-only bundle on the existing staging origin; no auth or financial writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(root, 'app-shell/web/node_modules/esbuild'));
const { chromium } = await import(pathToFileURL(process.env.FINANCE_PLAYWRIGHT_MODULE).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-notification-check-'));
fs.writeFileSync(path.join(tmp, 'entry.jsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import FinanceNotifications, {FinanceNotice, FinanceNotificationProvider} from ${JSON.stringify(path.join(root, 'features/finance/web/FinanceNotifications.jsx'))};
import ${JSON.stringify(path.join(root, 'features/finance/web/finance.css'))};
function Review(){const [notice,setNotice]=React.useState(''),[error,setError]=React.useState(''),[mounted,setMounted]=React.useState(true),[pending,setPending]=React.useState(false);
return <FinanceNotificationProvider><main><button onClick={()=>setNotice('Account saved successfully.')}>Save account</button>
<button onClick={()=>setError('Permission denied; nothing posted.')}>Fail action</button>
<button onClick={()=>setMounted(false)}>Leave workspace</button><button onClick={()=>setPending(true)}>Uncertain request</button>
<button disabled={pending}>Post another action</button>
{mounted&&<FinanceNotifications error={error} notice={notice} onErrorDismiss={()=>setError('')} onNoticeDismiss={()=>setNotice('')}/>}
<FinanceNotice message={pending?'Confirm this saved request before posting again.':''} tone="warning" dismissible={false}><button onClick={()=>setPending(false)}>Confirm saved request</button></FinanceNotice>
</main></FinanceNotificationProvider>;} createRoot(document.getElementById('review')).render(<Review/>);`);
esbuild.buildSync({ entryPoints: [path.join(tmp, 'entry.jsx')], outfile: path.join(tmp, 'bundle.js'), bundle: true, format: 'iife', nodePaths: [path.join(root, 'app-shell/web/node_modules')], define: { 'process.env.NODE_ENV': '"development"' } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], checks = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.clock.install({ time: new Date('2026-10-13T00:00:00Z') });
  await page.goto('http://127.0.0.1:8280/');
  await page.evaluate(() => { document.body.innerHTML = '<div id="review"></div>'; });
  await page.addStyleTag({ path: path.join(tmp, 'bundle.css') });
  await page.addScriptTag({ path: path.join(tmp, 'bundle.js') });
  const toast = page.locator('.finance-toast');
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await toast.getByText('Account saved successfully.', { exact: true }).waitFor();
  assert.equal(await toast.getAttribute('role'), 'status');
  assert.equal(await page.locator('main .alert').count(), 0);
  assert.equal(await page.locator('.finance-toasts').evaluate((el) => getComputedStyle(el).position), 'fixed');
  assert.equal(await toast.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  await page.mouse.move(0, 800);
  await page.clock.runFor(6100);
  await toast.waitFor({ state: 'hidden' });
  checks.push('success is a pop-up outside page layout and automatically clears');

  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await toast.hover(); await page.clock.runFor(10000);
  assert.equal(await toast.count(), 1);
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).focus();
  await page.mouse.move(0, 800); await page.clock.runFor(10000);
  assert.equal(await toast.count(), 1);
  await page.keyboard.press('Enter'); await toast.waitFor({ state: 'hidden' });
  checks.push('hover and keyboard focus preserve reading time; keyboard dismissal works');

  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await page.getByRole('button', { name: 'Fail action', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.finance-toast').length === 2);
  assert.equal(await toast.count(), 2);
  await page.mouse.move(0, 800); await page.clock.runFor(10000);
  assert.equal(await toast.count(), 1); assert.equal(await toast.getAttribute('role'), 'alert');
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await toast.waitFor({ state: 'hidden' });
  checks.push('concurrent messages stack; errors persist until dismissed');

  await page.getByRole('button', { name: 'Fail action', exact: true }).click();
  await page.getByRole('button', { name: 'Leave workspace', exact: true }).click();
  await toast.waitFor({ state: 'hidden' });
  checks.push('workspace unmount removes stale messages');

  await page.getByRole('button', { name: 'Uncertain request', exact: true }).click();
  await toast.getByText('Confirm this saved request before posting again.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Post another action', exact: true }).isDisabled(), true);
  assert.equal(await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).count(), 0);
  await page.clock.runFor(10000); assert.equal(await toast.count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.finance-toasts').isVisible(), false);
  await page.emulateMedia({ media: 'screen' });
  await toast.getByRole('button', { name: 'Confirm saved request', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Post another action', exact: true }).isDisabled(), false);
  await toast.waitFor({ state: 'hidden' });
  checks.push('pending recovery stays visible and blocks new writes; mobile fit and print exclusion');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, browserErrors: errors, financialWrites: 0 }, null, 2));
} finally { await browser.close(); }

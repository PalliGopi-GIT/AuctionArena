import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
for (const name of ['P001_KL_Rahul.png', 'P002_Rishabh_Pant.png']) {
  const source = resolve('Assets/player-images', name);
  await page.goto(pathToFileURL(source).href);
  const info = await page.evaluate(async () => {
    const img = document.querySelector('img');
    const before = img ? { complete: img.complete, naturalWidth: img.naturalWidth, src: img.src.slice(0, 80) } : null;
    let error = null;
    try { await img?.decode(); } catch (e) { error = String(e); }
    return { before, after: img ? { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight } : null, error };
  });
  console.log(name, JSON.stringify(info));
}
await browser.close();

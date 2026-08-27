import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve('output/csw-carousel');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(root, 'carousel.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
for (let index = 1; index <= 8; index += 1) {
  const slide = page.locator(`#slide-${index}`);
  await slide.screenshot({ path: path.join(root, `csw-carousel-${String(index).padStart(2, '0')}.png`) });
}
await browser.close();

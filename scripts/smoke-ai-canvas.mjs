import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/opt/cursor/artifacts/screenshots';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

  // Pan camera far from origin via the store.
  await page.evaluate(() => {
    const store = window.__STUDYBOARD_STORE__;
    store.setState({
      document: {
        ...store.getState().document,
        camera: { x: -2400, y: -1800, zoom: 1 },
        elements: [],
      },
      past: [],
      future: [],
      selectedIds: [],
    });
  });

  await page.click('.ai-ask-pill');
  await page.fill('.ai-prompt-input', "Explain Faraday's law simply");
  await page.keyboard.press('Enter');

  // Wait for canvas element insert.
  await page.waitForFunction(() => {
    const els = window.__STUDYBOARD_STORE__.getState().document.elements;
    return els.length === 1 && els[0].type === 'text';
  }, { timeout: 10000 });

  const afterInsert = await page.evaluate(() => {
    const s = window.__STUDYBOARD_STORE__.getState();
    const el = s.document.elements[0];
    return {
      count: s.document.elements.length,
      type: el?.type,
      text: el?.type === 'text' ? el.text : null,
      x: el?.x,
      y: el?.y,
      selected: s.selectedIds,
      metadata: el?.metadata,
      camera: s.document.camera,
      responsePanel: !!document.querySelector('.ai-response-panel'),
      statusChip: document.querySelector('.ai-status-chip')?.textContent ?? null,
    };
  });

  await page.screenshot({ path: `${OUT}/ai-text-on-canvas.png`, fullPage: true });

  // Undo
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => window.__STUDYBOARD_STORE__.getState().document.elements.length === 0,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${OUT}/ai-text-undone.png`, fullPage: true });

  // Redo
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(
    () => window.__STUDYBOARD_STORE__.getState().document.elements.length === 1,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${OUT}/ai-text-redone.png`, fullPage: true });

  const afterRedo = await page.evaluate(() => {
    const s = window.__STUDYBOARD_STORE__.getState();
    return {
      count: s.document.elements.length,
      text: s.document.elements[0]?.type === 'text' ? s.document.elements[0].text : null,
    };
  });

  console.log(JSON.stringify({ afterInsert, afterRedo }, null, 2));

  if (afterInsert.count !== 1) throw new Error('expected 1 element');
  if (afterInsert.type !== 'text') throw new Error('expected text');
  if (!afterInsert.text?.includes('mock AI response')) throw new Error('bad text');
  if (afterInsert.responsePanel) throw new Error('response panel still present');
  if (afterInsert.x < 2000) throw new Error('expected viewport-centred world x after pan');
  if (afterRedo.count !== 1) throw new Error('redo failed');

  await browser.close();
  console.log('SMOKE_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

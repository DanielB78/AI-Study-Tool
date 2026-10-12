/**
 * Smoke: RAG debug panel — seed notes, retrieve, anchors, radius, preview, send.
 * Run: node scripts/smoke-rag-debug.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/opt/cursor/artifacts/screenshots';
const BASE = 'http://127.0.0.1:5173/';
const API = 'http://127.0.0.1:8000';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Let hydrate's debounced ragSync.scheduleReconcile (400ms) finish first so it
  // cannot wipe a subsequent reindex with a stale element snapshot.
  await page.waitForTimeout(600);

  // Seed four text elements via the canvas store (world space).
  const seeded = await page.evaluate(() => {
    const store = window.__STUDYBOARD_STORE__;
    const now = Date.now();
    const mk = (id, text, x, y) => ({
      id,
      type: 'text',
      x,
      y,
      width: 280,
      height: 90,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      text,
      fontSize: 16,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      fontItalic: false,
      underline: false,
      strikethrough: false,
      color: '#111',
      alignment: 'left',
      lineHeight: 1.35,
      backgroundColor: null,
      padding: 8,
      cornerRadius: 0,
    });
    const elements = [
      mk('tb-gauss', "Gauss's law relates electric flux to enclosed charge.", 80, 80),
      mk(
        'tb-sphere',
        'For spherical symmetry the electric field has equal magnitude at a fixed radius.',
        400,
        100,
      ),
      mk(
        'tb-flux',
        'Electric flux measures the electric field passing through a surface.',
        100,
        240,
      ),
      mk(
        'tb-faraday',
        "Faraday's law relates changing magnetic flux to induced electric fields.",
        1400,
        1100,
      ),
    ];
    const doc = store.getState().document;
    store.setState({
      document: {
        ...doc,
        camera: { x: 40, y: 40, zoom: 1 },
        elements,
      },
      past: [],
      future: [],
      selectedIds: [],
    });
    return { boardId: store.getState().document.id, count: elements.length };
  });

  // Index directly via backend so retrieve works even if fire-and-forget missed.
  const reindexBody = {
    elements: [
      {
        board_id: seeded.boardId,
        element_id: 'tb-gauss',
        element_type: 'text',
        text: "Gauss's law relates electric flux to enclosed charge.",
        x: 80,
        y: 80,
        width: 280,
        height: 90,
      },
      {
        board_id: seeded.boardId,
        element_id: 'tb-sphere',
        element_type: 'text',
        text: 'For spherical symmetry the electric field has equal magnitude at a fixed radius.',
        x: 400,
        y: 100,
        width: 280,
        height: 90,
      },
      {
        board_id: seeded.boardId,
        element_id: 'tb-flux',
        element_type: 'text',
        text: 'Electric flux measures the electric field passing through a surface.',
        x: 100,
        y: 240,
        width: 280,
        height: 90,
      },
      {
        board_id: seeded.boardId,
        element_id: 'tb-faraday',
        element_type: 'text',
        text: "Faraday's law relates changing magnetic flux to induced electric fields.",
        x: 1400,
        y: 1100,
        width: 280,
        height: 90,
      },
    ],
  };
  const reindexRes = await fetch(`${API}/api/rag/boards/${seeded.boardId}/reindex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reindexBody),
  });
  if (!reindexRes.ok) {
    throw new Error(`reindex failed ${reindexRes.status}: ${await reindexRes.text()}`);
  }

  // Confirm chunks exist before UI retrieve.
  const chunksRes = await fetch(`${API}/api/rag/boards/${seeded.boardId}/chunks`);
  const chunks = await chunksRes.json();
  if (!Array.isArray(chunks) || chunks.length < 4) {
    throw new Error(`expected >=4 chunks, got ${JSON.stringify(chunks)}`);
  }

  // Open RAG debug panel
  await page.click('.rag-debug-toggle');
  await page.waitForSelector('.rag-debug-panel');
  await page.screenshot({ path: `${OUT}/rag-debug-panel-open.png` });

  const prompt =
    "Explain why Gauss's law is useful for spherical symmetry.";
  await page.fill('#rag-debug-prompt', prompt);
  await page.click('button.rag-debug-btn.primary:has-text("Retrieve")');
  await page.waitForFunction(
    () => (window.__RAG_DEBUG__?.getState()?.candidates?.length ?? 0) > 0,
    null,
    { timeout: 15000 },
  );
  await page.waitForSelector('.rag-debug-item', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/rag-debug-semantic-matches.png` });

  // Top 1
  await page.click('button.rag-debug-btn.ghost:has-text("Top 1")');
  await page.waitForFunction(() => {
    const text = document.querySelector('.rag-debug-counts')?.textContent ?? '';
    return text.includes('Semantic anchors:') && /Semantic anchors:\s*1/.test(text);
  });

  // Radius 0 → no spatial
  await page.fill('.rag-debug-number', '0');
  await page.dispatchEvent('.rag-debug-number', 'change');
  // Also set via store for reliability
  await page.evaluate(() => window.__RAG_DEBUG__.getState().setRadius(0));
  await page.waitForTimeout(200);
  let counts = await page.evaluate(
    () => document.querySelector('.rag-debug-counts')?.textContent ?? '',
  );
  if (!/Spatial additions:\s*0/.test(counts)) {
    throw new Error(`expected 0 spatial at radius 0, got: ${counts}`);
  }
  await page.screenshot({ path: `${OUT}/rag-debug-radius-0.png` });

  // Increase radius to include nearby B/C but not far D
  await page.evaluate(() => window.__RAG_DEBUG__.getState().setRadius(200));
  await page.waitForTimeout(300);
  counts = await page.evaluate(
    () => document.querySelector('.rag-debug-counts')?.textContent ?? '',
  );
  const snapshot = await page.evaluate(() => {
    const s = window.__RAG_DEBUG__.getState();
    // compute via panel text
    return {
      counts: document.querySelector('.rag-debug-counts')?.textContent ?? '',
      selected: s.selectedAnchorIds,
      radius: s.radius,
      candidateIds: s.candidates.map((c) => c.element_id),
    };
  });
  console.log('radius200', snapshot);
  if (!/Spatial additions:\s*[1-9]/.test(snapshot.counts)) {
    throw new Error(`expected spatial additions at r=200, got: ${snapshot.counts}`);
  }
  await page.screenshot({ path: `${OUT}/rag-debug-radius-expanded.png` });

  // Preview
  await page.click('button.rag-debug-btn:has-text("Preview context")');
  await page.waitForSelector('#rag-debug-serialized');
  const serialized = await page.inputValue('#rag-debug-serialized');
  if (!serialized.includes('CANVAS CONTEXT')) throw new Error('missing serialized context');
  if (!serialized.includes('SOURCE:')) throw new Error('missing source in context');
  await page.screenshot({ path: `${OUT}/rag-debug-context-preview.png` });

  // Ensure Faraday far element not in context at r=200
  if (serialized.includes('tb-faraday') || serialized.includes("Faraday's law")) {
    // only fail if it was added as spatial — may appear if selected semantically
    const selected = snapshot.selected;
    if (!selected.includes('tb-faraday')) {
      throw new Error('Faraday should be excluded at radius 200');
    }
  }

  const beforeCount = await page.evaluate(
    () => window.__STUDYBOARD_STORE__.getState().document.elements.length,
  );

  await page.click('button.rag-debug-btn.primary:has-text("Send with context")');
  await page.waitForFunction(
    (n) => window.__STUDYBOARD_STORE__.getState().document.elements.length > n,
    beforeCount,
    { timeout: 15000 },
  );

  const afterSend = await page.evaluate(() => {
    const els = window.__STUDYBOARD_STORE__.getState().document.elements;
    const last = els[els.length - 1];
    return {
      count: els.length,
      lastText: last?.type === 'text' ? last.text : null,
      status: document.querySelector('.rag-debug-status')?.textContent ?? null,
    };
  });
  console.log('afterSend', afterSend);
  if (!afterSend.lastText?.includes('mock AI response')) {
    throw new Error('expected mock AI reply on canvas');
  }
  if (!afterSend.lastText.includes('canvas_context received')) {
    throw new Error('expected mock to acknowledge canvas_context');
  }
  await page.screenshot({ path: `${OUT}/rag-debug-sent-with-context.png` });

  await browser.close();
  console.log('SMOKE_RAG_DEBUG_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

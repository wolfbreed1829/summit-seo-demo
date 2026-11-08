import test from 'node:test';
import assert from 'node:assert/strict';

const base = (process.env.SUMMIT_BASE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
const analyze = (html) => fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: html });

test('the serving runtime identifies itself as Unison', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.match((await response.json()).runtime, /Unison/);
});

test('HTML metadata is analyzed by the running service', async () => {
  const response = await analyze(`<html lang="en"><title>Mountain hiking gear and expert trail advice | Summit</title><meta name="description" content="Find thoughtfully selected hiking equipment, useful trail guides, and expert advice for your next outdoor adventure. Explore the collection at Summit today."><link rel="canonical" href="https://example.com"><h1>Explore more</h1><img alt="Trail"></html>`);
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.score, 100);
  assert.equal(report.checks.length, 7);
  assert.equal(report.h1Count, 1);
});

test('missing metadata and noindex produce actionable failures', async () => {
  const report = await (await analyze('<meta name="robots" content="NOINDEX"><img src="a"><h1>One</h1><h1>Two</h1>')).json();
  assert.equal(report.missingAlt, 1);
  assert.equal(report.h1Count, 2);
  assert.equal(report.checks.find(c => c.id === 'indexable').status, 'fail');
  assert.equal(report.checks.find(c => c.id === 'title').status, 'fail');
});

test('comments and script text do not create false headings', async () => {
  const report = await (await analyze('<!-- <h1>Fake</h1> --><script>const x="<h1>Fake</h1>"</script><h1>Real</h1>')).json();
  assert.equal(report.h1Count, 1);
});

test('robots none blocks indexing when combined with other directives', async () => {
  const report = await (await analyze('<meta name="robots" content="none, max-image-preview:large"><h1>Private</h1>')).json();
  assert.equal(report.checks.find(c => c.id === 'indexable').status, 'fail');
});

test('quoted delimiters, entities and JSON control characters survive safely', async () => {
  const title = 'A "quote" \\ trail\n\t\u0001 & summit';
  const report = await (await analyze(`<TITLE>${title.replace('&', '&amp;')}</TITLE><META CONTENT='Useful > details' NAME=DESCRIPTION>`)).json();
  assert.equal(report.title, title);
  assert.equal(report.description, 'Useful > details');
});

test('empty and non-HTML inputs are rejected', async () => {
  for (const input of ['', 'not a document']) {
    const response = await analyze(input);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /HTML/);
  }
});

test('oversized and invalid UTF-8 inputs are rejected', async () => {
  assert.equal((await analyze('<html>' + 'a'.repeat(500000))).status, 400);
  assert.equal((await analyze(new Uint8Array([0xff, 0xfe, 0x3c]))).status, 400);
});

test('only authored assets are served; responses have correct content types', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal((await fetch(base + '/src/audit.u')).status, 404);
  assert.equal((await fetch(base + '/not-found')).status, 404);
});

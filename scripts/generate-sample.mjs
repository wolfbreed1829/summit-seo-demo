import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { sampleAuditSource } = require('../web/app.js');
if (!sampleAuditSource) throw new Error('The demo HTML sample is missing.');
const response = await fetch('http://127.0.0.1:4174/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: sampleAuditSource
});
if (!response.ok) throw new Error(`Unison audit returned HTTP ${response.status}`);
const report = await response.json();
report.sample = {
  runtime: 'Unison 1.3',
  sourceSha256: createHash('sha256').update(sampleAuditSource).digest('hex'),
  notice: 'Precomputed example from the real Unison audit engine. Custom audits require the local app.'
};
await mkdir(new URL('../demo/', import.meta.url), { recursive: true });
await writeFile(new URL('../demo/sample-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Saved actual Unison sample audit: ${report.score}/100, ${report.checks.length} checks.`);

#!/usr/bin/env node
// Lists titles whose outcome changed between the rules-only detector and
// the detector with the n-gram model. Usage: node tests/lang-eval/diff.js [--text]
const fs = require('fs');
const path = require('path');
const { loadDetector } = require('./load-detector');

const byText = process.argv.includes('--text');
const before = loadDetector(undefined, { model: false });
const after = loadDetector();
const data = [
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'titles.json'), 'utf8')),
  // Titles from personal watch history: local only (gitignored), used when present.
  ...(fs.existsSync(path.join(__dirname, 'titles-history.json'))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, 'titles-history.json'), 'utf8')) : []),
];
const ok = (want, got) => (['en', 'es', 'fr', 'zh'].includes(want) ? got === want : !['en', 'es', 'fr', 'zh'].includes(got));
const lines = { fixed: [], broke: [], changed: [] };
for (const item of data) {
  const want = byText ? item.text : (item.audio ?? item.text);
  const a = before(item.title);
  const b = after(item.title);
  if (a === b) continue;
  const kind = !ok(want, a) && ok(want, b) ? 'fixed' : ok(want, a) && !ok(want, b) ? 'broke' : 'changed';
  lines[kind].push(`${want} ${a}→${b} | ${item.title}`);
}
for (const [kind, list] of Object.entries(lines)) console.log(`\n== ${kind} (${list.length})\n${list.join('\n')}`);

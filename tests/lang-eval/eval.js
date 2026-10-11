#!/usr/bin/env node
// Scores the title language detector against the labelled set in
// titles.json. Usage: node tests/lang-eval/eval.js [--proxy] [--errors]
//
// Each entry's `text` is the language of the title text itself (or "none"
// when the title has no language-bearing words); `audio` is the spoken
// language from tracking history, where known.
const fs = require('fs');
const path = require('path');
const { loadDetector, loadProxyDetector } = require('./load-detector');

const SUPPORTED = new Set(['en', 'es', 'fr', 'zh']);
const args = new Set(process.argv.slice(2));
const detect = args.has('--proxy') ? loadProxyDetector() : loadDetector();
const loadSet = (name) => (fs.existsSync(path.join(__dirname, name))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')) : []);
// --dev / --holdout pick half of the harvested real-YouTube titles each
// (split by a hash of the title), so thresholds tuned on one half can be
// checked on the other.
const half = (title) => [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2;
const harvested = loadSet('titles-harvested.json').filter((o) =>
  args.has('--dev') ? half(o.title) === 0 : args.has('--holdout') ? half(o.title) === 1 : true);
// --orig scores only the original set (history + written titles).
const data = args.has('--dev') || args.has('--holdout') ? harvested : [...(args.has('--orig') ? [] : harvested),
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'titles.json'), 'utf8')),
  // Titles from personal watch history: local only (gitignored), used when present.
  ...(fs.existsSync(path.join(__dirname, 'titles-history.json'))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, 'titles-history.json'), 'utf8')) : []),
];

// Per-title outcome against the label of the title text:
//   correct  – supported language, detected right
//   unknown  – supported language, detector gave up (null)
//   wrong    – detector named a language the title isn't in (the bad one:
//              it shows unwanted videos or hides wanted ones)
//   rejected – unsupported/none label, detector said null or a non-filter
//              language (correct behaviour)
const bucket = (label, got) => {
  if (SUPPORTED.has(label)) {
    if (got === label) return 'correct';
    return got == null ? 'unknown' : 'wrong';
  }
  return got != null && SUPPORTED.has(got) ? 'wrong' : 'rejected';
};

// The languages being learned. "missed": a video in one of them that the
// detector didn't recognise (hidden when unknowns are hidden). "leaked": a
// video detected as one of them that isn't (shown when it shouldn't be).
const PRIORITY = ['es', 'fr', 'zh'];
const prio = Object.fromEntries(PRIORITY.map((l) => [l, { n: 0, missed: 0, leaked: 0 }]));
const rows = {};
const errors = [];
const t0 = process.hrtime.bigint();
for (const item of data) {
  const got = detect(item.title);
  // Default target is what the filter is for: the spoken language when
  // tracking history knows it, else the title's own language.
  const want = args.has('--text') ? item.text : (item.audio ?? item.text);
  const b = bucket(want, got);
  const key = `${want}${item.title.split(/\s+/).length <= 3 ? ' (short)' : ''}`;
  if (prio[want]) { prio[want].n++; if (got !== want) prio[want].missed++; }
  if (prio[got] && got !== want) prio[got].leaked++;
  rows[key] ??= { n: 0, correct: 0, unknown: 0, wrong: 0, rejected: 0 };
  rows[key].n++;
  rows[key][b]++;
  if (b === 'wrong' || (b === 'unknown' && args.has('--unknown'))) errors.push(`${b.padEnd(7)} ${want} → ${got}  | ${item.title}`);
}
const perTitleUs = Number(process.hrtime.bigint() - t0) / 1000 / data.length;

const pct = (a, n) => (n ? `${((100 * a) / n).toFixed(0)}%` : '-').padStart(5);
console.log('label            n  correct unknown  wrong  rejected');
let tot = { n: 0, correct: 0, unknown: 0, wrong: 0, rejected: 0 };
for (const key of Object.keys(rows).sort()) {
  const r = rows[key];
  for (const k of Object.keys(tot)) tot[k] += r[k];
  console.log(`${key.padEnd(14)} ${String(r.n).padStart(4)}  ${pct(r.correct, r.n)}   ${pct(r.unknown, r.n)}  ${pct(r.wrong, r.n)}   ${pct(r.rejected, r.n)}`);
}
console.log(`${'TOTAL'.padEnd(14)} ${String(tot.n).padStart(4)}  ${pct(tot.correct, tot.n)}   ${pct(tot.unknown, tot.n)}  ${pct(tot.wrong, tot.n)}   ${pct(tot.rejected, tot.n)}`);
console.log(`\n${PRIORITY.map((l) => `${l}: missed ${prio[l].missed}/${prio[l].n}, leaked ${prio[l].leaked}`).join('   ')}`);
console.log(`wrong: ${tot.wrong}   unknown: ${tot.unknown}   ~${perTitleUs.toFixed(1)}µs/title`);
if (args.has('--errors')) console.log(`\n${errors.join('\n')}`);

// Pulls detectLanguageFromTitle out of content-script.js (or a patched
// copy of it) so it can be scored in Node without a browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDetector(source, { model = true } = {}) {
  const src = source ?? fs.readFileSync(path.join(__dirname, '../../content-script.js'), 'utf8');
  const start = src.indexOf('const DEFAULTS');
  const end = src.indexOf('// --- Filtering ---');
  if (start < 0 || end < 0) throw new Error('detector markers not found');
  const body = src.slice(start, end);
  const ctx = vm.createContext({ console, window: {}, document: undefined, location: { pathname: '/' } });
  ctx.globalThis = ctx;
  const modelPath = path.join(__dirname, '../../lang-model.js');
  if (model && fs.existsSync(modelPath)) vm.runInContext(fs.readFileSync(modelPath, 'utf8'), ctx);
  vm.runInContext(`${body}\nthis.detect = detectLanguageFromTitle;\nthis.tuning = typeof MODEL_TUNING === 'undefined' ? null : MODEL_TUNING;`, ctx);
  ctx.detect.tuning = ctx.tuning;
  return ctx.detect;
}

module.exports = { loadDetector };

// The yt.olimedia.uk proxy serves content-script.js with regex patches
// applied (applyProxyContentScriptFixes in the proxy's server.js); load
// that variant too so both deployments get scored.
function loadProxyDetector(serverPath = path.join(__dirname, '../../../youtube-language-filter-proxy/server.js')) {
  const server = fs.readFileSync(serverPath, 'utf8');
  const grab = (name) => {
    const i = server.indexOf(`function ${name}(`);
    const j = server.indexOf('\n}\n', i);
    if (i < 0 || j < 0) throw new Error(`${name} not found in proxy server.js`);
    return server.slice(i, j + 2);
  };
  const ctx = vm.createContext({ console });
  vm.runInContext(`${grab('applyContentScriptReplacement')}\n${grab('applyProxyContentScriptFixes')}\nthis.patch = applyProxyContentScriptFixes;`, ctx);
  const src = fs.readFileSync(path.join(__dirname, '../../content-script.js'), 'utf8');
  return loadDetector(ctx.patch(src));
}

module.exports.loadProxyDetector = loadProxyDetector;

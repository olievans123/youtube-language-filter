const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  enabled: true,
  selectedLanguage: 'en',
  selectedLanguages: ['en'],
  showUnknown: true,
  keepSubscribed: true
};

const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'es', 'fr', 'zh']);
const LANGUAGE_ALIASES = {
  english: 'en',
  spanish: 'es',
  espanol: 'es',
  french: 'fr',
  francais: 'fr',
  mandarin: 'zh',
  chinese: 'zh'
};

function normalizeLanguageValue(value) {
  if (typeof value !== 'string') return DEFAULTS.selectedLanguage;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULTS.selectedLanguage;

  const asciiNormalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shortCode = asciiNormalized.split('-')[0];
  if (SUPPORTED_LANGUAGE_CODES.has(shortCode)) return shortCode;

  return LANGUAGE_ALIASES[asciiNormalized] || DEFAULTS.selectedLanguage;
}

function normalizeConfig(value) {
  const raw = value || {};
  const merged = { ...DEFAULTS, ...raw };
  const hasExplicitSelectedLanguages = Object.prototype.hasOwnProperty.call(raw, 'selectedLanguages');
  const languageSource = hasExplicitSelectedLanguages
    ? raw.selectedLanguages
    : (raw.selectedLanguage ?? DEFAULTS.selectedLanguages);
  const selectedLanguages = normalizeLanguageArray(languageSource);

  return {
    enabled: Boolean(merged.enabled),
    selectedLanguage: selectedLanguages[0],
    selectedLanguages,
    showUnknown: Boolean(merged.showUnknown),
    keepSubscribed: Boolean(merged.keepSubscribed)
  };
}

function normalizeLanguageArray(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = [];

  for (const raw of rawValues) {
    const code = normalizeLanguageValue(raw);
    if (!SUPPORTED_LANGUAGE_CODES.has(code)) continue;
    if (!normalized.includes(code)) normalized.push(code);
  }

  if (normalized.length === 0) return [DEFAULTS.selectedLanguage];
  return normalized;
}

function storageGet() {
  if (!api?.storage?.local) return Promise.resolve({ ...DEFAULTS });
  try {
    const result = api.storage.local.get(DEFAULTS);
    if (result?.then) return result.catch(() => ({ ...DEFAULTS }));
  } catch {}

  return new Promise((resolve) => {
    try {
      api.storage.local.get(DEFAULTS, (items) => resolve(items || { ...DEFAULTS }));
    } catch {
      resolve({ ...DEFAULTS });
    }
  });
}

async function queryTabs(queryInfo = {}) {
  if (!api?.tabs?.query) return [];
  try {
    const result = api.tabs.query(queryInfo);
    if (result?.then) return result.catch(() => []);
  } catch {}

  return new Promise((resolve) => {
    try {
      api.tabs.query(queryInfo, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch {
      resolve([]);
    }
  });
}

async function sendMessageToTab(tabId, message) {
  if (!api?.tabs?.sendMessage || tabId == null) return;
  try {
    const result = api.tabs.sendMessage(tabId, message);
    if (result?.then) {
      await result.catch(() => {});
      return;
    }
  } catch {}

  await new Promise((resolve) => {
    try {
      api.tabs.sendMessage(tabId, message, () => resolve());
    } catch {
      resolve();
    }
  });
}

function isYouTubeUrl(url) {
  return typeof url === 'string' && /^https?:\/\/([a-z0-9-]+\.)*youtube\.com\//i.test(url);
}

async function getConfig() {
  const config = await storageGet();
  return normalizeConfig(config);
}

async function broadcastConfig(configOverride) {
  const config = normalizeConfig(configOverride || await getConfig());
  const tabs = await queryTabs({});
  const targets = tabs.filter((tab) => isYouTubeUrl(tab?.url));
  await Promise.all(targets.map((tab) => sendMessageToTab(tab.id, { type: 'configUpdate', config })));
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'getConfig') {
    getConfig().then(sendResponse);
    return true;
  }

  if (msg?.type === 'configSaved') {
    broadcastConfig(msg.config)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName && areaName !== 'local') return;
  broadcastConfig();
});

(() => {
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

  const extensionAPI = (() => {
    if (typeof browser !== 'undefined' && browser?.storage) return browser;
    if (typeof chrome !== 'undefined' && chrome?.storage) return chrome;
    return null;
  })();
  const storageArea = extensionAPI?.storage?.local ?? null;

  const elements = {
    enabled: document.getElementById('enabled'),
    languageOptions: document.getElementById('languageOptions'),
    showUnknown: document.getElementById('showUnknown'),
    keepSubscribed: document.getElementById('keepSubscribed'),
    status: document.getElementById('status'),
    langCard: document.getElementById('langCard'),
    unknownCard: document.getElementById('unknownCard'),
    subscribedCard: document.getElementById('subscribedCard')
  };

  const updateDisabledState = () => {
    const disabled = !elements.enabled.checked;
    elements.langCard.classList.toggle('disabled', disabled);
    elements.unknownCard.classList.toggle('disabled', disabled);
    elements.subscribedCard.classList.toggle('disabled', disabled);
  };

  const setStatus = (message, type = '') => {
    elements.status.textContent = message;
    elements.status.className = `status${type ? ` ${type}` : ''}`;
  };

  const normalizeLanguageValue = (value) => {
    if (typeof value !== 'string') return DEFAULTS.selectedLanguage;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return DEFAULTS.selectedLanguage;

    const asciiNormalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const shortCode = asciiNormalized.split('-')[0];

    if (SUPPORTED_LANGUAGE_CODES.has(shortCode)) return shortCode;
    return LANGUAGE_ALIASES[asciiNormalized] || DEFAULTS.selectedLanguage;
  };

  const normalizeConfig = (value) => {
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
  };

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

  const storageGet = () => {
    if (!storageArea) return Promise.resolve({ ...DEFAULTS });
    try {
      const result = storageArea.get(DEFAULTS);
      if (result?.then) return result.catch(() => ({ ...DEFAULTS }));
    } catch {}
    return new Promise((resolve) => {
      try {
        storageArea.get(DEFAULTS, (items) => resolve(items || { ...DEFAULTS }));
      } catch {
        resolve({ ...DEFAULTS });
      }
    });
  };

  const storageSet = (values) => {
    if (!storageArea) return Promise.resolve();
    try {
      const result = storageArea.set(values);
      if (result?.then) return result;
    } catch {}
    return new Promise((resolve, reject) => {
      try {
        storageArea.set(values, () => {
          const err = extensionAPI?.runtime?.lastError;
          if (err) { reject(new Error(err.message)); return; }
          resolve();
        });
      } catch (e) { reject(e); }
    });
  };

  const getLanguageCheckboxes = () =>
    Array.from(elements.languageOptions.querySelectorAll('input[type="checkbox"][value]'));

  const readFormValues = () => {
    const checked = getLanguageCheckboxes()
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value);
    const selectedLanguages = normalizeLanguageArray(checked);

    // Keep UI and storage consistent when user unchecks everything.
    if (checked.length === 0) {
      for (const checkbox of getLanguageCheckboxes()) {
        checkbox.checked = selectedLanguages.includes(checkbox.value);
      }
    }

    return {
      enabled: elements.enabled.checked,
      selectedLanguage: selectedLanguages[0],
      selectedLanguages,
      showUnknown: elements.showUnknown.checked,
      keepSubscribed: elements.keepSubscribed.checked
    };
  };

  const writeFormValues = (values) => {
    elements.enabled.checked = values.enabled;
    for (const checkbox of getLanguageCheckboxes()) {
      checkbox.checked = values.selectedLanguages.includes(checkbox.value);
    }
    elements.showUnknown.checked = values.showUnknown;
    elements.keepSubscribed.checked = values.keepSubscribed;
  };

  const sendRuntimeMessage = (message) => {
    if (!extensionAPI?.runtime?.sendMessage) return Promise.resolve(null);
    try {
      const result = extensionAPI.runtime.sendMessage(message);
      if (result?.then) return result.catch(() => null);
    } catch {}

    return new Promise((resolve) => {
      try {
        extensionAPI.runtime.sendMessage(message, (response) => resolve(response ?? null));
      } catch {
        resolve(null);
      }
    });
  };

  const queryTabs = (queryInfo) => {
    if (!extensionAPI?.tabs?.query) return Promise.resolve([]);
    try {
      const result = extensionAPI.tabs.query(queryInfo);
      if (result?.then) return result.catch(() => []);
    } catch {}

    return new Promise((resolve) => {
      try {
        extensionAPI.tabs.query(queryInfo, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
      } catch {
        resolve([]);
      }
    });
  };

  const sendTabMessage = (tabId, message) => {
    if (!extensionAPI?.tabs?.sendMessage || tabId == null) return Promise.resolve(null);
    try {
      const result = extensionAPI.tabs.sendMessage(tabId, message);
      if (result?.then) return result.catch(() => null);
    } catch {}

    return new Promise((resolve) => {
      try {
        extensionAPI.tabs.sendMessage(tabId, message, (response) => {
          const err = extensionAPI?.runtime?.lastError;
          if (err) {
            resolve(null);
            return;
          }
          resolve(response ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  };

  const isYouTubeUrl = (url) =>
    typeof url === 'string' && /^https?:\/\/([a-z0-9-]+\.)*youtube\.com\//i.test(url);

  const checkPageAccess = async () => {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab || !isYouTubeUrl(activeTab.url)) return true;

    const response = await sendTabMessage(activeTab.id, { type: 'ping' });
    if (response?.ok) return true;

    setStatus('No YouTube page access in Safari Extensions', 'error');
    return false;
  };

  const save = async () => {
    try {
      const values = readFormValues();
      await storageSet(values);
      await sendRuntimeMessage({ type: 'configSaved', config: values });
      setStatus('Saved', 'success');
      setTimeout(() => setStatus(''), 1500);
      await checkPageAccess();
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    }
  };

  elements.enabled.addEventListener('change', () => {
    updateDisabledState();
    save();
  });
  for (const checkbox of getLanguageCheckboxes()) {
    checkbox.addEventListener('change', save);
  }
  elements.showUnknown.addEventListener('change', save);
  elements.keepSubscribed.addEventListener('change', save);


  storageGet().then((values) => {
    const normalized = normalizeConfig(values);
    writeFormValues(normalized);
    updateDisabledState();
    return checkPageAccess();
  }).catch((err) => {
    setStatus(`Load error: ${err.message}`, 'error');
  });
})();

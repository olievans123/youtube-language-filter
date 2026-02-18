(() => {
  const CARD_SELECTORS = [
    'ytd-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-rich-grid-media',
    'ytd-rich-grid-slim-media',
    'ytd-rich-grid-radio-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-radio-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model'
  ].join(',');
  const CARD_ROOT_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'ytd-compact-radio-renderer',
    'ytd-rich-grid-radio-renderer',
    'ytd-reel-item-renderer',
    'yt-lockup-view-model',
    'ytd-rich-grid-media',
    'ytd-rich-grid-slim-media'
  ].join(',');
  const TITLE_SELECTORS = [
    '#video-title',
    '#video-title-link',
    'a#video-title-link',
    'yt-formatted-string#video-title',
    'a.yt-lockup-view-model-wiz__title',
    'h3 a[href*="/watch"]',
    'a[href*="list="]'
  ].join(',');
  const VIDEO_LINK_SELECTORS = [
    'a#video-title-link[href]',
    'a#video-title[href]',
    'a.yt-lockup-view-model-wiz__title[href]',
    'a[href*="/watch"]',
    'a[href*="/shorts/"]'
  ].join(',');

  const PROCESSED_ATTR = 'data-lang-filter-checked';
  const HIDDEN_ATTR = 'data-lang-filter-hidden';
  const RETRY_ATTR = 'data-lang-filter-retries';
  const MAX_TITLE_RETRIES = 4;
  const BATCHING_CLASS = 'yt-lang-filter-batching';
  const MAX_BATCHING_MS = 850;
  const MIN_BATCHING_MS = 140;

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

  // Prefer browser (Safari native) over chrome
  const extensionAPI = (() => {
    if (typeof browser !== 'undefined' && browser?.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome;
    return null;
  })();
  const storageArea = extensionAPI?.storage?.local ?? null;

  let config = { ...DEFAULTS };
  let processTimer = null;
  let batchingTimer = null;
  let batchingReleaseTimer = null;
  let batchingStartedAt = 0;
  let lastRouteKey = '';
  let lastPathname = '';
  let pendingElements = new Set();
  const titleLanguageCache = new Map();

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

  // --- Language detection data ---

  const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
  const CJK_ALL_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
  const JA_RE = /[\u3040-\u309F\u30A0-\u30FF]/;
  const KO_RE = /[\uAC00-\uD7AF\u1100-\u11FF]/;

  // Function words only (accent-normalized) — articles, prepositions,
  // pronouns, conjunctions, auxiliaries, common adverbs.
  const WORD_LISTS = {
    en: new Set([
      'the','and','is','are','was','were','will','have','has','been',
      'this','that','with','for','not','but','you','all','can','from',
      'they','her','his','what','when','how','why','who','which',
      'about','would','could','should','into','more','some','than',
      'them','these','other','only','also','very','even','most',
      'much','many','where','after','before','every','through',
      'because','your','our','their','there','here','while',
      'between','both','during','might','another','being','over',
      'again','then','once','such','same','just','like',
      'or','if','so','my','to','of','in','it','on','at','by',
      'an','we','do','no','its','out','did','had','any','now'
    ]),
    es: new Set([
      'el','la','los','las','un','una','de','del','al','con','por',
      'para','que','en','es','son','como','mas','pero','este',
      'esta','estos','estas','ese','esa','muy','cuando','donde',
      'porque','entre','desde','hasta','sobre','todo','cada',
      'otro','otra','sin','siempre','nunca','puede','tiene',
      'hay','tambien','despues','antes','nos','les','su','sus',
      'mi','mis','tu','tus','yo','ella','ellos','nosotros',
      'ya','aqui','asi','solo','mucho','poco','mejor','peor',
      'nuevo','nueva','bueno','buena','grande','se','lo','le'
    ]),
    fr: new Set([
      'le','la','les','un','une','de','des','du','au','aux',
      'et','est','sont','dans','pour','pas','qui','vers',
      'sur','avec','plus','mais','tout','cette','ces','ses',
      'mon','mes','par','vous','nous','ils','elles',
      'aussi','tres','meme','ou','comme','quand','depuis',
      'apres','avant','toujours','jamais','je','tu','il',
      'elle','on','leur','leurs','notre','votre','ce','cet',
      'ici','donc','alors','ni','car','puis',
      'encore','rien','peu','beaucoup','trop','assez','ne'
    ])
  };

  const ZH_STRONG_KEYWORDS = new Set([
    'mandarin',
    'zhongwen',
    'putonghua',
    'hanyu',
    'hanzi',
    'hsk',
    'pinyin',
    'cantonese'
  ]);

  const ZH_WEAK_KEYWORDS = new Set([
    'chinese'
  ]);

  const LEARNING_CONTEXT = new Set([
    'learn',
    'learning',
    'comprehensible',
    'input',
    'podcast',
    'vocabulary',
    'grammar',
    'lesson',
    'lessons',
    'beginner',
    'intermediate',
    'advanced',
    'study',
    'studying',
    'course',
    'courses',
    'naturally'
  ]);

  const ES_STRONG_KEYWORDS = new Set([
    'espanol'
  ]);

  const ES_WEAK_KEYWORDS = new Set([
    'spanish'
  ]);

  const ES_KEYWORDS = new Set([
    'spanishdrill',
    'reggaeton',
    'latino',
    'bachata',
    'merced',
    'oficial',
    'perreo',
    'instale',
    'rompio',
    'cambia'
  ]);

  const FR_STRONG_KEYWORDS = new Set([
    'francais',
    'francophone'
  ]);

  const FR_WEAK_KEYWORDS = new Set([
    'french'
  ]);

  const FR_KEYWORDS = new Set([
    'retour',
    'frontieres',
    'miroir',
    'pourquoi',
    'merci',
    'saison',
    'debut',
    'aventure',
    'itineraire',
    'gourmand',
    'semaines',
    'meduses',
    'histoire',
    'cote',
    'sorti',
    'faut',
    'pire',
    'monde',
    'temps',
    'tete',
    'tetes',
    'acheter',
    'disparition'
  ]);

  // --- Config via messaging (background has reliable storage access) ---

  const loadConfig = async () => {
    let loaded = null;

    if (extensionAPI?.runtime?.sendMessage) {
      try {
        loaded = await Promise.race([
          extensionAPI.runtime.sendMessage({ type: 'getConfig' }),
          new Promise((resolve) => setTimeout(() => resolve(null), 500))
        ]);
      } catch {}
    }

    if (!loaded) {
      loaded = await storageGet();
    }

    Object.assign(config, normalizeConfig(loaded));
  };

  const subscribeToConfigChanges = () => {
    if (!extensionAPI?.runtime?.onMessage?.addListener) return;
    extensionAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === 'ping') {
        sendResponse?.({ ok: true });
        return true;
      }

      if (msg?.type === 'configUpdate' && msg.config) {
        Object.assign(config, normalizeConfig(msg.config));
        reEvaluateAll();
      }
    });
  };

  const subscribeToStorageChanges = () => {
    if (!extensionAPI?.storage?.onChanged?.addListener) return;

    extensionAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName && areaName !== 'local') return;
      if (!changes || typeof changes !== 'object') return;

      let didChange = false;
      const nextConfig = { ...config };

      for (const key of Object.keys(DEFAULTS)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        const change = changes[key];
        const newValue = change && Object.prototype.hasOwnProperty.call(change, 'newValue')
          ? change.newValue
          : nextConfig[key];
        nextConfig[key] = newValue;
        didChange = true;
      }

      if (!didChange) return;
      Object.assign(config, normalizeConfig(nextConfig));
      reEvaluateAll();
    });
  };

  // --- Language detection from DOM title ---

  const collapseWhitespace = (text) =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

  const findCardRoot = (node) => {
    if (!(node instanceof Element)) return null;
    return node.closest(CARD_ROOT_SELECTORS);
  };

  const setCardHidden = (card, hidden) => {
    const richItemWrapper = card instanceof Element
      ? card.closest('ytd-rich-item-renderer')
      : null;

    if (hidden) {
      card.setAttribute(HIDDEN_ATTR, 'true');
      if (richItemWrapper) richItemWrapper.setAttribute(HIDDEN_ATTR, 'true');
    } else {
      card.removeAttribute(HIDDEN_ATTR);
      if (richItemWrapper) richItemWrapper.removeAttribute(HIDDEN_ATTR);
    }
  };

  const readNodeText = (node) => {
    if (!(node instanceof Element)) return '';
    const directText = collapseWhitespace(node.textContent);
    if (directText) return directText;

    const titleAttr = collapseWhitespace(node.getAttribute?.('title'));
    if (titleAttr) return titleAttr;

    const ariaLabel = collapseWhitespace(node.getAttribute?.('aria-label'));
    if (ariaLabel) {
      const trimmed = ariaLabel
        .split(/\s[•·|]\s|\n| - | — /u)[0]
        .trim();
      const lowered = trimmed.toLowerCase();
      const splitters = [' by ', ' por ', ' par ', ' von '];
      for (const splitter of splitters) {
        const index = lowered.indexOf(splitter);
        if (index > 10) return trimmed.slice(0, index).trim();
      }
      return trimmed;
    }

    return '';
  };

  const normalizeCandidateText = (value) =>
    collapseWhitespace(value)
      .replace(/\u200B/g, '')
      .trim();

  const CANDIDATE_SOURCE_BONUS = {
    title_node: 90,
    title_attr: 75,
    title_aria: 80,
    link_node: 70,
    link_attr: 60,
    link_aria: 65,
    list_link: 85,
    fallback_attr: 50
  };

  const METADATA_NOISE_RE = /\b\d+(?:[.,]\d+)?\s*(?:k|m|b)?\s*views?\b|\b(?:streamed|updated)\b|\b\d+\s*(?:hours?|days?|weeks?|months?|years?)\s+ago\b/i;

  const scoreCandidateText = (text, source = 'link_node') => {
    const normalized = normalizeCandidateText(text);
    if (!normalized) return -Infinity;

    const lower = normalized.toLowerCase();
    let score = Math.min(normalized.length, 180)
      + (CANDIDATE_SOURCE_BONUS[source] || 0);

    if (lower === 'mix' || lower === 'playlist') {
      score -= 200;
    } else if (/^mix\b/.test(lower) && normalized.length <= 12) {
      score -= 120;
    } else if (/^mix\b/.test(lower)) {
      score += 10;
    }

    if (/video oficial|spanishdrill|reggaeton|francais|mandarin|chinese|中文|漢語|汉语/i.test(normalized)) {
      score += 30;
    }

    if (METADATA_NOISE_RE.test(normalized)) {
      score -= 80;
    }

    return score;
  };

  const collectVideoElements = (rootNode = document) => {
    const cards = new Set();

    if (!rootNode?.querySelectorAll) return [];

    if (rootNode instanceof Element && !rootNode.closest('ytd-miniplayer')) {
      if (rootNode.matches(CARD_SELECTORS)) {
        const root = findCardRoot(rootNode) || rootNode;
        cards.add(root);
      }
      if (rootNode.matches(VIDEO_LINK_SELECTORS)) {
        const root = findCardRoot(rootNode);
        if (root) cards.add(root);
      }
    }

    for (const element of rootNode.querySelectorAll(CARD_SELECTORS)) {
      if (element.closest('ytd-miniplayer')) continue;
      const root = findCardRoot(element) || element;
      cards.add(root);
    }

    for (const link of rootNode.querySelectorAll(VIDEO_LINK_SELECTORS)) {
      if (link.closest('ytd-miniplayer')) continue;
      const root = findCardRoot(link);
      if (root) cards.add(root);
    }

    return Array.from(cards);
  };

  const queueElements = (rootNode) => {
    for (const element of collectVideoElements(rootNode)) {
      if (element.hasAttribute(PROCESSED_ATTR)) continue;
      pendingElements.add(element);
    }
  };

  const extractTitleText = (videoElement) => {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (rawText, source) => {
      const text = normalizeCandidateText(rawText);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ text, source });
    };

    for (const titleEl of videoElement.querySelectorAll(TITLE_SELECTORS)) {
      pushCandidate(readNodeText(titleEl), 'title_node');
      pushCandidate(titleEl.getAttribute?.('title'), 'title_attr');
      pushCandidate(titleEl.getAttribute?.('aria-label'), 'title_aria');
    }

    for (const link of videoElement.querySelectorAll(VIDEO_LINK_SELECTORS)) {
      pushCandidate(readNodeText(link), 'link_node');
      pushCandidate(link.getAttribute?.('title'), 'link_attr');
      pushCandidate(link.getAttribute?.('aria-label'), 'link_aria');
    }

    for (const listLink of videoElement.querySelectorAll('a[href*="list="]')) {
      pushCandidate(readNodeText(listLink), 'list_link');
      pushCandidate(listLink.getAttribute?.('aria-label'), 'list_link');
      pushCandidate(listLink.getAttribute?.('title'), 'list_link');
    }

    const altTitle = videoElement.querySelector('a[href*="/watch"][title], a[title]');
    if (altTitle) {
      pushCandidate(altTitle.getAttribute('title'), 'fallback_attr');
    }

    if (candidates.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = scoreCandidateText(candidate.text, candidate.source);
      if (score > bestScore) {
        bestScore = score;
        best = candidate.text;
      }
    }

    return best || null;
  };

  const normalize = (word) =>
    word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const tokenize = (text) =>
    text.replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(normalize);

  const detectLanguageFromTitle = (title) => {
    if (!title) return null;

    // Japanese kana present → can't be sure it's Chinese → unknown
    if (JA_RE.test(title)) return null;

    // Korean hangul → unknown
    if (KO_RE.test(title)) return null;

    // CJK ideographs (with no Japanese/Korean) → likely Chinese
    if (CJK_RE.test(title)) {
      const cjkCount = (title.match(CJK_ALL_RE) || []).length;
      const charCount = title.replace(/\s/g, '').length;
      if (cjkCount >= 2 && charCount > 0 && cjkCount / charCount > 0.12) return 'zh';
      if (cjkCount >= 4) return 'zh';
    }

    // Latin-script: match function words
    const words = tokenize(title);

    // Language-learning titles are often in Latin script with keyword markers.
    const zhStrongMatches = words.filter((word) => ZH_STRONG_KEYWORDS.has(word)).length;
    const zhWeakMatches = words.filter((word) => ZH_WEAK_KEYWORDS.has(word)).length;
    const esStrongMatches = words.filter((word) => ES_STRONG_KEYWORDS.has(word)).length;
    const esWeakMatches = words.filter((word) => ES_WEAK_KEYWORDS.has(word)).length;
    const frStrongMatches = words.filter((word) => FR_STRONG_KEYWORDS.has(word)).length;
    const frWeakMatches = words.filter((word) => FR_WEAK_KEYWORDS.has(word)).length;
    const learningMatches = words.filter((word) => LEARNING_CONTEXT.has(word)).length;

    if (zhStrongMatches >= 1) return 'zh';
    if (zhWeakMatches >= 1 && learningMatches >= 1) return 'zh';
    if (esStrongMatches >= 1) return 'es';
    if (frStrongMatches >= 1) return 'fr';
    if (esWeakMatches >= 1 && learningMatches >= 1) return 'es';
    if (frWeakMatches >= 1 && learningMatches >= 1) return 'fr';

    const hasSpanishAccent = /[áéíóúñ]/i.test(title);
    const hasFrenchAccent = /[àâçéèêëîïôûùüÿœæ]/i.test(title);
    const spanishKeywordMatches = words.filter((word) => ES_KEYWORDS.has(word)).length;
    const frenchKeywordMatches = words.filter((word) => FR_KEYWORDS.has(word)).length;
    const spanishFunctionMatches = words.filter((word) => WORD_LISTS.es.has(word)).length;
    const frenchFunctionMatches = words.filter((word) => WORD_LISTS.fr.has(word)).length;

    if (spanishKeywordMatches >= 2 || (spanishKeywordMatches >= 1 && hasSpanishAccent)) {
      return 'es';
    }
    if (spanishKeywordMatches >= 1 && spanishFunctionMatches >= 1) {
      return 'es';
    }
    if (spanishKeywordMatches >= 1 && /\bvideo\s+oficial\b/i.test(title)) {
      return 'es';
    }
    if (frenchKeywordMatches >= 2 || (frenchKeywordMatches >= 1 && hasFrenchAccent)) {
      return 'fr';
    }
    if (frenchKeywordMatches >= 1 && frenchFunctionMatches >= 1) {
      return 'fr';
    }

    if (words.length < 3) return null;

    let bestLang = null;
    let bestCount = 0;
    let secondCount = 0;

    for (const [lang, wordSet] of Object.entries(WORD_LISTS)) {
      let count = 0;
      for (const w of words) {
        if (wordSet.has(w)) count++;
      }
      if (count > bestCount) {
        secondCount = bestCount;
        bestCount = count;
        bestLang = lang;
      } else if (count > secondCount) {
        secondCount = count;
      }
    }

    // Need ≥ 2 matches, a reasonable share of words, and a clear winner.
    const minRatio = words.length <= 10 ? 0.2 : 0.18;
    if (bestCount < 2 || bestCount / words.length < minRatio) return null;
    if (bestCount <= secondCount) return null;

    return bestLang;
  };

  // --- Filtering ---

  const getCachedLanguage = (title) => {
    if (!title) return null;
    if (titleLanguageCache.has(title)) return titleLanguageCache.get(title);

    const language = detectLanguageFromTitle(title);
    titleLanguageCache.set(title, language);

    if (titleLanguageCache.size > 2000) {
      titleLanguageCache.clear();
    }

    return language;
  };

  const getSearchQueryLanguageHints = () => {
    if ((location.pathname || '') !== '/results') return [];

    let rawQuery = '';
    try {
      const params = new URLSearchParams(location.search || '');
      rawQuery = params.get('search_query') || params.get('query') || '';
    } catch {
      rawQuery = '';
    }

    const words = tokenize(rawQuery);
    const hinted = new Set();

    for (const word of words) {
      if (SUPPORTED_LANGUAGE_CODES.has(word)) {
        hinted.add(word);
        continue;
      }
      const alias = LANGUAGE_ALIASES[word];
      if (alias && SUPPORTED_LANGUAGE_CODES.has(alias)) {
        hinted.add(alias);
      }
    }

    return Array.from(hinted);
  };

  const applyLanguageDecision = (element, language, selectedLanguages) => {
    const finalLanguage = language || 'unknown';
    element.setAttribute(PROCESSED_ATTR, finalLanguage);
    element.removeAttribute(RETRY_ATTR);

    const hintedSearchLanguages = getSearchQueryLanguageHints();
    const keepUnknownForSearch = language === null
      && hintedSearchLanguages.length > 0
      && hintedSearchLanguages.some((code) => selectedLanguages.has(code));

    const shouldHide = language === null
      ? !(config.showUnknown || keepUnknownForSearch)
      : !selectedLanguages.has(language);
    setCardHidden(element, shouldHide);
  };

  const stopBatching = () => {
    if (batchingTimer) {
      clearTimeout(batchingTimer);
      batchingTimer = null;
    }
    const body = document.body;
    if (!body?.classList.contains(BATCHING_CLASS)) return;

    if (batchingReleaseTimer) {
      clearTimeout(batchingReleaseTimer);
      batchingReleaseTimer = null;
    }

    const elapsedMs = Date.now() - batchingStartedAt;
    const remainingMs = Math.max(0, MIN_BATCHING_MS - elapsedMs);
    if (remainingMs > 0) {
      batchingReleaseTimer = setTimeout(() => {
        batchingReleaseTimer = null;
        body.classList.remove(BATCHING_CLASS);
      }, remainingMs);
      return;
    }

    body.classList.remove(BATCHING_CLASS);
  };

  const startBatching = () => {
    if (!config.enabled) return;
    if (batchingReleaseTimer) {
      clearTimeout(batchingReleaseTimer);
      batchingReleaseTimer = null;
    }
    batchingStartedAt = Date.now();
    document.body?.classList.add(BATCHING_CLASS);
    if (batchingTimer) clearTimeout(batchingTimer);
    batchingTimer = setTimeout(() => {
      batchingTimer = null;
      document.body?.classList.remove(BATCHING_CLASS);
    }, MAX_BATCHING_MS);
  };

  const processVideoElements = () => {
    if (!config.enabled) {
      stopBatching();
      return;
    }

    if (pendingElements.size === 0) {
      stopBatching();
      return;
    }

    const elements = Array.from(pendingElements);
    pendingElements.clear();
    const selectedLanguages = new Set(
      normalizeLanguageArray(config.selectedLanguages ?? config.selectedLanguage)
    );
    let hasPendingElements = false;

    for (const candidate of elements) {
      const el = findCardRoot(candidate) || candidate;
      if (!el?.isConnected) continue;
      if (el.hasAttribute(PROCESSED_ATTR)) continue;

      const title = collapseWhitespace(extractTitleText(el));
      if (!title || title.length < 2) {
        const retries = Number.parseInt(el.getAttribute(RETRY_ATTR) || '0', 10) + 1;
        el.setAttribute(RETRY_ATTR, String(retries));

        if (retries >= MAX_TITLE_RETRIES) {
          applyLanguageDecision(el, null, selectedLanguages);
        } else {
          pendingElements.add(el);
          hasPendingElements = true;
        }

        continue;
      }

      const language = getCachedLanguage(title);

      // Always show videos from subscribed channels
      if (config.keepSubscribed && isSubscribedChannel(el)) {
        el.setAttribute(PROCESSED_ATTR, language || 'unknown');
        el.removeAttribute(RETRY_ATTR);
        setCardHidden(el, false);
        continue;
      }

      applyLanguageDecision(el, language, selectedLanguages);
    }

    if (hasPendingElements) {
      scheduleProcessing(90);
    } else {
      stopBatching();
    }
  };

  const scheduleProcessing = (delayMs = 20) => {
    clearTimeout(processTimer);
    processTimer = setTimeout(() => {
      processTimer = null;
      processVideoElements();
    }, delayMs);
  };

  const reEvaluateAll = () => {
    pendingElements.clear();
    setFilterActive(config.enabled);
    if (config.enabled) {
      startBatching();
    } else {
      stopBatching();
    }

    document.querySelectorAll(`[${PROCESSED_ATTR}], [${RETRY_ATTR}], [${HIDDEN_ATTR}]`).forEach((el) => {
      if (el.closest('ytd-miniplayer')) return;
      el.removeAttribute(PROCESSED_ATTR);
      el.removeAttribute(HIDDEN_ATTR);
      el.removeAttribute(RETRY_ATTR);
    });

    queueElements(document);
    scheduleProcessing(40);
  };

  // Quietly reveal hidden cards that are now known to be from subscribed
  // channels (e.g. after hydration adds new channels). Does not touch
  // already-visible cards, so there is no flash. Skips the homepage to
  // avoid layout shifts on the main feed.
  const unhideSubscribedCards = () => {
    if (!config.enabled || !config.keepSubscribed) return;
    if ((location.pathname || '/') === '/') return;
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
      if (el.closest('ytd-miniplayer')) return;
      if (isSubscribedChannel(el)) {
        el.removeAttribute(HIDDEN_ATTR);
      }
    });
  };

  const queueAndProcess = (rootNode, delayMs = 20) => {
    queueElements(rootNode);
    if (pendingElements.size > 0) {
      scheduleProcessing(delayMs);
    }
  };

  let navigationReEvalTimer = null;
  const getCurrentRouteKey = () => `${location.pathname || ''}${location.search || ''}`;
  const scheduleNavigationReEvaluate = (delayMs = 80) => {
    if (navigationReEvalTimer) clearTimeout(navigationReEvalTimer);
    navigationReEvalTimer = setTimeout(() => {
      navigationReEvalTimer = null;
      const nextRouteKey = getCurrentRouteKey();
      const nextPathname = location.pathname || '';

      if (nextRouteKey === lastRouteKey) {
        queueAndProcess(document, 40);
        return;
      }

      lastRouteKey = nextRouteKey;
      lastPathname = nextPathname;

      // Search results mutate heavily while preserving URL-ish state.
      // Avoid full resets there; process incrementally.
      if (nextPathname === '/results') {
        queueAndProcess(document, 40);
        return;
      }

      refreshSubscribedChannels();
      reEvaluateAll();
    }, delayMs);
  };

  // --- Subscribed channel detection (from sidebar) ---

  let subscribedChannelHrefs = null;
  let subscribedChannelHydratePromise = null;
  let hydratedChannelHrefs = null;

  const normalizeChannelHref = (href) => {
    if (typeof href !== 'string' || !href.trim()) return null;

    let pathname = href.trim();
    try {
      const parsed = new URL(pathname, location.origin);
      pathname = parsed.pathname || '';
    } catch {}

    pathname = pathname.split('?')[0].split('#')[0].toLowerCase();
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;

    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    const first = parts[0];
    const second = parts[1];

    if (first.startsWith('@')) return `/${first}`;
    if ((first === 'channel' || first === 'c' || first === 'user') && second) {
      return `/${first}/${second}`;
    }

    return null;
  };

  const getSubscribedChannels = () => {
    if (subscribedChannelHrefs !== null) return subscribedChannelHrefs;

    const channels = new Set();
    const guide = document.querySelector('ytd-guide-renderer');
    if (guide) {
      for (const link of guide.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href');
        const normalized = normalizeChannelHref(href);
        if (normalized) channels.add(normalized);
      }
    }

    // Merge persistent hydrated data from /feed/channels
    if (hydratedChannelHrefs) {
      for (const href of hydratedChannelHrefs) {
        channels.add(href);
      }
    }

    // Only cache when we have data (sidebar or hydrated); otherwise
    // leave null so subsequent calls re-check once the sidebar loads.
    if (channels.size > 0 || guide) {
      subscribedChannelHrefs = channels;
    }

    if (config.keepSubscribed && !hydratedChannelHrefs) {
      void hydrateSubscribedChannelsFromFeed();
    }
    return channels;
  };

  const hydrateSubscribedChannelsFromFeed = () => {
    if (!config.keepSubscribed) return Promise.resolve();
    if (subscribedChannelHydratePromise) return subscribedChannelHydratePromise;

    subscribedChannelHydratePromise = fetch('/feed/channels', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.text() : ''))
      .then((html) => {
        if (!html) return;

        const fetched = new Set();
        const collectHref = (href) => {
          const normalized = normalizeChannelHref(href);
          if (normalized) fetched.add(normalized);
        };

        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const link of doc.querySelectorAll('a[href]')) {
            collectHref(link.getAttribute('href'));
          }
        } catch {}

        const escapedMatches = html.match(/\\\/(?:@[^"\\\/?]+|channel\\\/[A-Za-z0-9_-]+|c\\\/[A-Za-z0-9_.-]+|user\\\/[A-Za-z0-9_.-]+)/g) || [];
        for (const escapedPath of escapedMatches) {
          collectHref(escapedPath.replace(/\\\//g, '/'));
        }

        const plainMatches = html.match(/\/(?:@[^"\/?]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_.-]+)/g) || [];
        for (const plainPath of plainMatches) {
          collectHref(plainPath);
        }

        if (fetched.size === 0) return;

        hydratedChannelHrefs = fetched;

        // Merge into the live set (if cached) and trigger re-evaluation
        let didAdd = false;
        if (subscribedChannelHrefs) {
          for (const href of fetched) {
            if (!subscribedChannelHrefs.has(href)) {
              subscribedChannelHrefs.add(href);
              didAdd = true;
            }
          }
        } else {
          subscribedChannelHrefs = new Set(fetched);
          didAdd = true;
        }

        if (didAdd) {
          unhideSubscribedCards();
        }
      })
      .catch(() => {})
      .finally(() => {
        subscribedChannelHydratePromise = null;
      });

    return subscribedChannelHydratePromise;
  };

  const refreshSubscribedChannels = () => {
    subscribedChannelHrefs = null;
    // Preserve hydratedChannelHrefs and in-flight hydration promise —
    // hydration only needs to run once per session.
  };

  const CHANNEL_LINK_SELECTORS = [
    'ytd-channel-name a[href]',
    '#channel-name a[href]',
    '#owner-name a[href]',
    '#text a[href]',
    'yt-lockup-view-model a[href^="/@"]',
    'yt-lockup-view-model a[href^="/channel/"]',
    'yt-lockup-view-model a[href^="/c/"]',
    'yt-lockup-view-model a[href^="/user/"]'
  ].join(',');
  const isSubscribedChannel = (videoElement) => {
    const channels = getSubscribedChannels();
    const pageChannel = normalizeChannelHref(location.pathname);

    // Check per-card channel links against the subscribed set
    let hasCardChannelLink = false;
    if (channels.size > 0) {
      for (const channelLink of videoElement.querySelectorAll(CHANNEL_LINK_SELECTORS)) {
        hasCardChannelLink = true;
        const href = channelLink.getAttribute('href');
        const normalized = normalizeChannelHref(href);
        if (normalized && channels.has(normalized)) return true;
      }

      // On channel pages, cards lack per-card channel links.
      // Only fall back to page URL when the card has none of its own,
      // since during SPA transitions location.pathname can be stale.
      if (!hasCardChannelLink && pageChannel && channels.has(pageChannel)) return true;
    }

    // Last resort: on channel pages when the sidebar is collapsed and
    // hydration hasn't completed yet, check the page's subscribe button.
    if (!hasCardChannelLink && pageChannel) {
      const subBtn = document.querySelector(
        'ytd-subscribe-button-renderer[subscribed], ytd-subscribe-button-renderer[is-subscribed]'
      );
      if (subBtn) return true;
    }

    return false;
  };

  // --- Anti-jitter CSS (hides unprocessed cards until classified) ---

  const FILTER_STYLE_ID = 'yt-lang-filter-style';

  const injectFilterCSS = () => {
    if (document.getElementById(FILTER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FILTER_STYLE_ID;
    const prefix = 'body.yt-lang-filter-active';
    const batchingPrefix = `html ${prefix}.${BATCHING_CLASS}`;
    const roots = CARD_ROOT_SELECTORS.split(',').map(s => s.trim());

    style.textContent = [
      // Hide unprocessed cards until classified (prevents pop-in on scroll)
      roots.map(r => `${prefix} ${r}:not([${PROCESSED_ATTR}])`).join(','),
      '{ opacity: 0 !important; }',
      // Reveal processed, visible cards with a smooth fade-in
      roots.map(r => `${prefix} ${r}[${PROCESSED_ATTR}]:not([${HIDDEN_ATTR}])`).join(','),
      '{ opacity: 1 !important; transition: opacity 0.15s ease !important; }',
      // During full re-evaluations (back/home navigation), hide cards briefly
      // and reveal in one batch to avoid card-by-card pop-in.
      roots.map(r => `${batchingPrefix} ${r}`).join(','),
      '{ opacity: 0 !important; transition: opacity 0.12s ease !important; }',
      // Collapse hidden cards instantly
      roots.map(r => `${prefix} ${r}[${HIDDEN_ATTR}]`).join(','),
      '{ display: none !important; }',
      // Prevent visible items from stretching into space left by hidden siblings
      `${prefix} ytd-rich-item-renderer:not([${HIDDEN_ATTR}])`,
      '{ flex-grow: 0 !important; }',
      // Collapse grid rows where all items have been filtered out
      `${prefix} ytd-rich-grid-row:not(:has(ytd-rich-item-renderer:not([${HIDDEN_ATTR}])))`,
      '{ display: none !important; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  };

  const setFilterActive = (active) => {
    if (active) {
      document.body?.classList.add('yt-lang-filter-active');
    } else {
      document.body?.classList.remove('yt-lang-filter-active');
      stopBatching();
    }
  };

  // --- Bootstrap ---

  const bootstrap = () => {
    injectFilterCSS();
    subscribeToConfigChanges();
    subscribeToStorageChanges();

    loadConfig().then(() => {
      lastRouteKey = getCurrentRouteKey();
      lastPathname = location.pathname || '';
      setFilterActive(config.enabled);
      queueAndProcess(document, 0);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          queueAndProcess(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('yt-navigate-finish', () => {
      scheduleNavigationReEvaluate();
    });
    window.addEventListener('spfdone', () => {
      scheduleNavigationReEvaluate();
    });
    // Search pages emit this event frequently while results stream in.
    // Incremental queueing avoids full reset loops that keep cards in
    // batching/hidden state indefinitely.
    window.addEventListener('yt-page-data-updated', () => queueAndProcess(document, 40));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

import { useCallback, useEffect, useRef, useState } from "react";
import {
  translateToKorean,
  warmupKoreanTranslation,
} from "../api.js";
import { staticKoreanTranslation } from "./koreanDictionary.js";

export const LANGUAGE_STORAGE_KEY = "news-language";
export const TRANSLATION_CACHE_STORAGE_KEY = "news-korean-translation-cache-v2";

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "placeholder", "title", "alt"];
const SKIP_SELECTOR = [
  "script",
  "style",
  "code",
  "pre",
  "textarea",
  "[contenteditable='true']",
  "[data-no-translate]",
].join(",");
const FIRST_BACKEND_BATCH_SIZE = 28;
const BACKEND_BATCH_SIZE = 80;
const SESSION_CACHE_ENTRIES = 1_200;
const SESSION_CACHE_CHARACTERS = 1_000_000;

export function hasEnglish(value) {
  const text = String(value || "").trim();
  if (!/[A-Za-z]/.test(text) || text.length < 2) return false;
  if (/^(?:https?:\/\/|www\.|mailto:)/i.test(text)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return false;
  if (/^[A-Z0-9_.:/\\-]{2,}$/.test(text) && !/\s/.test(text)) return false;
  return true;
}

export function uniqueTranslationValues(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!hasEnglish(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function preserveWhitespace(original, translated) {
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

function isSkipped(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !element || Boolean(element.closest(SKIP_SELECTOR));
}

function isVisiblePriority(element) {
  if (!element?.getBoundingClientRect) return 1;
  const bounds = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  return bounds.bottom >= -80 && bounds.top <= viewportHeight + 160 ? 0 : 1;
}

export function browserTranslationCapability(scope = globalThis) {
  const translatorApi = scope?.Translator;
  if (!scope?.isSecureContext || !translatorApi?.create) {
    return { available: false, reason: "unsupported" };
  }
  return { available: true, api: translatorApi };
}

function loadSessionCache() {
  if (typeof window === "undefined") return new Map();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(TRANSLATION_CACHE_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed
        .filter((entry) => Array.isArray(entry) && entry.length === 2)
        .map(([source, translated]) => [String(source), String(translated)])
        .filter(([source, translated]) => source && translated),
    );
  } catch {
    return new Map();
  }
}

function saveSessionCache(cache) {
  if (typeof window === "undefined") return;
  try {
    const entries = Array.from(cache.entries());
    const retained = [];
    let characters = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [source, translated] = entries[index];
      const size = source.length + translated.length;
      if (retained.length >= SESSION_CACHE_ENTRIES || characters + size > SESSION_CACHE_CHARACTERS) break;
      retained.push([source, translated]);
      characters += size;
    }
    window.sessionStorage.setItem(
      TRANSLATION_CACHE_STORAGE_KEY,
      JSON.stringify(retained.reverse()),
    );
  } catch {
    // Storage can be unavailable in private browsing. Translation still works;
    // only the per-tab speed cache is skipped.
  }
}

export function readStoredLanguage() {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "ko" ? "ko" : "en";
}

export function usePageTranslation(language) {
  const [state, setState] = useState({
    active: false,
    translating: false,
    pending: 0,
    completed: 0,
    total: 0,
    phase: "idle",
    engine: "automatic",
    downloadProgress: null,
    error: "",
  });
  const observerRef = useRef(null);
  const generationRef = useRef(0);
  const textOriginalsRef = useRef(new Map());
  const textAppliedRef = useRef(new WeakMap());
  const textQueuedRef = useRef(new WeakMap());
  const attributeOriginalsRef = useRef(new Map());
  const attributeAppliedRef = useRef(new WeakMap());
  const attributeQueuedRef = useRef(new WeakMap());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = loadSessionCache();
  const retryActionRef = useRef(() => {});
  const preparedNativeRef = useRef(null);
  const flushTimerRef = useRef(null);
  const scanTimerRef = useRef(null);
  const sessionSaveTimerRef = useRef(null);

  const restoreEnglish = useCallback(() => {
    for (const [node, original] of textOriginalsRef.current.entries()) {
      if (node.isConnected) node.nodeValue = original;
    }
    for (const [element, attributes] of attributeOriginalsRef.current.entries()) {
      if (!element.isConnected) continue;
      for (const [name, original] of attributes.entries()) {
        if (original === null) element.removeAttribute(name);
        else element.setAttribute(name, original);
      }
    }
    textOriginalsRef.current.clear();
    attributeOriginalsRef.current.clear();
    textAppliedRef.current = new WeakMap();
    textQueuedRef.current = new WeakMap();
    attributeAppliedRef.current = new WeakMap();
    attributeQueuedRef.current = new WeakMap();
  }, []);

  const prepareBrowser = useCallback(() => {
    const capability = browserTranslationCapability(window);
    if (!capability.available) return false;
    if (preparedNativeRef.current?.promise) return true;
    try {
      // Call create() synchronously inside the user's confirmation click. Some
      // Chrome versions require transient user activation before downloading a
      // missing language pack; deferring this call to a React effect can lose it.
      const created = capability.api.create({
        sourceLanguage: "en",
        targetLanguage: "ko",
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = Math.max(0, Math.min(100, Math.round(Number(event.loaded || 0) * 100)));
            setState((current) => ({
              ...current,
              phase: "downloading",
              downloadProgress: progress,
            }));
          });
        },
      });
      const promise = Promise.resolve(created).catch(() => null);
      preparedNativeRef.current = { promise };
      return true;
    } catch {
      preparedNativeRef.current = null;
      return false;
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "ko" ? "ko" : "en";
    document.documentElement.dataset.language = language;

    observerRef.current?.disconnect();
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    flushTimerRef.current = null;
    scanTimerRef.current = null;

    if (language !== "ko") {
      restoreEnglish();
      retryActionRef.current = () => {};
      setState({
        active: false,
        translating: false,
        pending: 0,
        completed: 0,
        total: 0,
        phase: "idle",
        engine: "automatic",
        downloadProgress: null,
        error: "",
      });
      return undefined;
    }

    const queue = new Map();
    const failed = new Map();
    const targets = new Map();
    const scanRoots = new Set();
    const discovered = new Set();
    let activeBatch = [];
    let sequence = 0;
    let completed = 0;
    let engineReady = false;
    let engine = "detecting";
    let nativeTranslator = null;
    let firstBackendBatch = true;
    let backendBatchSize = BACKEND_BATCH_SIZE;
    let stopped = false;

    const pendingCount = () => queue.size + activeBatch.length;
    const publishProgress = (patch = {}) => {
      if (stopped || generation !== generationRef.current) return;
      const pending = pendingCount();
      setState((current) => ({
        ...current,
        active: true,
        translating: pending > 0 || !engineReady,
        pending,
        completed,
        total: discovered.size,
        engine,
        phase: pending > 0 ? current.phase : engineReady ? "ready" : current.phase,
        ...patch,
      }));
    };

    const scheduleCacheSave = () => {
      if (sessionSaveTimerRef.current) return;
      sessionSaveTimerRef.current = window.setTimeout(() => {
        sessionSaveTimerRef.current = null;
        saveSessionCache(cacheRef.current);
      }, 250);
    };

    const applyTranslation = (source, translated) => {
      const clean = String(translated || "").trim();
      if (!clean) return false;
      cacheRef.current.delete(source);
      cacheRef.current.set(source, clean);
      scheduleCacheSave();
      const waiting = targets.get(source) || [];
      targets.delete(source);
      waiting.forEach((target) => {
        if (target.type === "text") {
          if (!target.node.isConnected || target.node.nodeValue !== target.original) return;
          const applied = preserveWhitespace(target.original, clean);
          textAppliedRef.current.set(target.node, applied);
          textQueuedRef.current.delete(target.node);
          target.node.nodeValue = applied;
          return;
        }
        if (!target.element.isConnected || target.element.getAttribute(target.name) !== target.original) return;
        const applied = preserveWhitespace(target.original, clean);
        const appliedMap = attributeAppliedRef.current.get(target.element) || new Map();
        appliedMap.set(target.name, applied);
        attributeAppliedRef.current.set(target.element, appliedMap);
        const queuedMap = attributeQueuedRef.current.get(target.element);
        queuedMap?.delete(target.name);
        target.element.setAttribute(target.name, applied);
      });
      if (discovered.has(source)) completed += 1;
      return true;
    };

    const registerTarget = (source, target, priority) => {
      if (!discovered.has(source)) discovered.add(source);
      const waiting = targets.get(source) || [];
      waiting.push(target);
      targets.set(source, waiting);
      const queued = queue.get(source);
      if (queued) {
        queued.priority = Math.min(queued.priority, priority);
      } else if (!failed.has(source)) {
        queue.set(source, { source, priority, sequence: sequence += 1, attempts: 0 });
      }
    };

    const translateTextNode = (node) => {
      if (isSkipped(node)) return;
      const current = node.nodeValue || "";
      const lastApplied = textAppliedRef.current.get(node);
      if (lastApplied && current === lastApplied) return;
      const original = current;
      const source = original.trim();
      if (!hasEnglish(source)) return;
      textOriginalsRef.current.set(node, original);
      const instant = staticKoreanTranslation(source) || cacheRef.current.get(source);
      if (instant) {
        const applied = preserveWhitespace(original, instant);
        textAppliedRef.current.set(node, applied);
        node.nodeValue = applied;
        return;
      }
      if (textQueuedRef.current.get(node) === source) return;
      textQueuedRef.current.set(node, source);
      registerTarget(source, { type: "text", node, original }, isVisiblePriority(node.parentElement));
    };

    const translateAttributes = (element) => {
      if (!(element instanceof Element) || isSkipped(element)) return;
      let originals = attributeOriginalsRef.current.get(element);
      const appliedMap = attributeAppliedRef.current.get(element) || new Map();
      const queuedMap = attributeQueuedRef.current.get(element) || new Map();
      for (const name of TRANSLATABLE_ATTRIBUTES) {
        const original = element.getAttribute(name);
        if (!original || appliedMap.get(name) === original || !hasEnglish(original)) continue;
        if (!originals) {
          originals = new Map();
          attributeOriginalsRef.current.set(element, originals);
        }
        originals.set(name, original);
        const source = original.trim();
        const instant = staticKoreanTranslation(source) || cacheRef.current.get(source);
        if (instant) {
          const applied = preserveWhitespace(original, instant);
          appliedMap.set(name, applied);
          element.setAttribute(name, applied);
          continue;
        }
        if (queuedMap.get(name) === source) continue;
        queuedMap.set(name, source);
        registerTarget(
          source,
          { type: "attribute", element, name, original },
          isVisiblePriority(element),
        );
      }
      attributeAppliedRef.current.set(element, appliedMap);
      attributeQueuedRef.current.set(element, queuedMap);
    };

    const scanDocument = (root = document.body) => {
      if (!root || stopped || generation !== generationRef.current) return;
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
      } else {
        translateAttributes(root);
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        );
        let current = walker.nextNode();
        while (current) {
          if (current.nodeType === Node.TEXT_NODE) translateTextNode(current);
          else translateAttributes(current);
          current = walker.nextNode();
        }
      }
      publishProgress({ phase: engineReady ? "translating" : "checking" });
      scheduleFlush();
    };

    const scheduleScan = (candidate) => {
      if (!candidate) return;
      for (const existing of scanRoots) {
        if (existing === candidate || existing.contains?.(candidate)) return;
        if (candidate.contains?.(existing)) scanRoots.delete(existing);
      }
      scanRoots.add(candidate);
      if (scanTimerRef.current) return;
      scanTimerRef.current = window.setTimeout(() => {
        scanTimerRef.current = null;
        const roots = Array.from(scanRoots);
        scanRoots.clear();
        roots.forEach((root) => scanDocument(root?.isConnected ? root : null));
      }, 16);
    };

    const orderedQueue = () => Array.from(queue.values()).sort(
      (left, right) => left.priority - right.priority || left.sequence - right.sequence,
    );

    const markBatchFailed = (batch, message) => {
      batch.forEach((item) => failed.set(item.source, item));
      activeBatch = [];
      publishProgress({
        translating: false,
        phase: "error",
        error: message || "Korean translation is unavailable.",
      });
    };

    const runNativeQueue = async () => {
      if (!nativeTranslator || activeBatch.length || !queue.size) return;
      const item = orderedQueue()[0];
      queue.delete(item.source);
      activeBatch = [item];
      publishProgress({ phase: "translating" });
      try {
        // Chrome's on-device Translator queues calls sequentially. Translating
        // one visible string at a time gives useful content immediately rather
        // than waiting for the entire page to finish.
        const translated = await nativeTranslator.translate(item.source);
        if (stopped || generation !== generationRef.current) return;
        if (!applyTranslation(item.source, translated)) {
          throw new Error("The browser translator returned an empty result.");
        }
        activeBatch = [];
        publishProgress({ phase: queue.size ? "translating" : "ready" });
        if (queue.size) scheduleFlush(0);
      } catch {
        activeBatch = [];
        queue.set(item.source, item);
        try { nativeTranslator.destroy?.(); } catch { /* optional browser API */ }
        nativeTranslator = null;
        preparedNativeRef.current = null;
        engineReady = false;
        engine = "local-marian";
        publishProgress({ phase: "loading-model" });
        prepareBackend();
      }
    };

    const runBackendQueue = async () => {
      if (activeBatch.length || !queue.size) return;
      const batchSize = firstBackendBatch
        ? Math.min(FIRST_BACKEND_BATCH_SIZE, backendBatchSize)
        : backendBatchSize;
      firstBackendBatch = false;
      activeBatch = orderedQueue().slice(0, batchSize);
      activeBatch.forEach((item) => queue.delete(item.source));
      publishProgress({ phase: "translating" });
      try {
        const requestTexts = uniqueTranslationValues(activeBatch.map((item) => item.source));
        const response = await translateToKorean(requestTexts);
        if (stopped || generation !== generationRef.current) return;
        const translations = Array.isArray(response?.translations) ? response.translations : [];
        const bySource = new Map(
          translations.map((item) => [String(item?.source || "").trim(), String(item?.translated || "")]),
        );
        const retryItems = [];
        activeBatch.forEach((item, index) => {
          const translated = bySource.get(item.source) || translations[index]?.translated;
          if (!applyTranslation(item.source, translated)) {
            retryItems.push({ ...item, attempts: item.attempts + 1 });
          }
        });
        activeBatch = [];
        retryItems.forEach((item) => {
          if (item.attempts <= 1) queue.set(item.source, item);
          else failed.set(item.source, item);
        });
        if (failed.size) {
          publishProgress({
            phase: "error",
            error: "Some content could not be translated. You can retry without losing the English originals.",
          });
          return;
        }
        publishProgress({ phase: queue.size ? "translating" : "ready" });
        if (queue.size) scheduleFlush(retryItems.length ? 350 : 20);
      } catch (error) {
        const retryable = activeBatch.filter((item) => item.attempts < 1);
        const exhausted = activeBatch.filter((item) => item.attempts >= 1);
        activeBatch = [];
        retryable.forEach((item) => queue.set(item.source, { ...item, attempts: item.attempts + 1 }));
        if (retryable.length && !exhausted.length) {
          publishProgress({ phase: "retrying" });
          scheduleFlush(600);
          return;
        }
        markBatchFailed(exhausted.length ? exhausted : retryable, error?.message);
      }
    };

    async function prepareBackend() {
      if (stopped || generation !== generationRef.current) return;
      engine = "local-marian";
      publishProgress({ phase: "loading-model", downloadProgress: null });
      try {
        const warmup = await warmupKoreanTranslation();
        backendBatchSize = Math.max(
          1,
          Math.min(100, Number(warmup?.max_items || BACKEND_BATCH_SIZE)),
        );
      } catch (error) {
        // A prior compatible server may not expose warmup; its normal batch
        // endpoint still provides the complete local fallback.
        if (Number(error?.status || 0) !== 404) {
          const unavailable = orderedQueue();
          queue.clear();
          markBatchFailed(unavailable, error?.message);
          return;
        }
      }
      if (stopped || generation !== generationRef.current) return;
      engineReady = true;
      publishProgress({ phase: "translating" });
      scheduleFlush(0);
    }

    async function prepareEngine() {
      const capability = browserTranslationCapability(window);
      if (capability.available) {
        try {
          if (preparedNativeRef.current?.promise) {
            engine = "browser-native";
            publishProgress({ phase: "preparing" });
            nativeTranslator = await preparedNativeRef.current.promise;
            if (nativeTranslator) {
              if (stopped || generation !== generationRef.current) {
                nativeTranslator.destroy?.();
                preparedNativeRef.current = null;
                return;
              }
              engineReady = true;
              publishProgress({ phase: "translating", downloadProgress: 100 });
              scheduleFlush(0);
              return;
            }
            preparedNativeRef.current = null;
          }
          let availability = "available";
          if (typeof capability.api.availability === "function") {
            availability = await capability.api.availability({
              sourceLanguage: "en",
              targetLanguage: "ko",
            });
          }
          if (!["unavailable", "no"].includes(availability)) {
            engine = "browser-native";
            publishProgress({
              phase: ["downloadable", "downloading", "after-download"].includes(availability)
                ? "downloading"
                : "preparing",
              downloadProgress: ["downloadable", "downloading", "after-download"].includes(availability)
                ? 0
                : null,
            });
            nativeTranslator = await capability.api.create({
              sourceLanguage: "en",
              targetLanguage: "ko",
              monitor(monitor) {
                monitor.addEventListener("downloadprogress", (event) => {
                  const progress = Math.max(0, Math.min(100, Math.round(Number(event.loaded || 0) * 100)));
                  publishProgress({ phase: "downloading", downloadProgress: progress });
                });
              },
            });
            if (stopped || generation !== generationRef.current) {
              nativeTranslator.destroy?.();
              return;
            }
            engineReady = true;
            publishProgress({ phase: "translating", downloadProgress: 100 });
            scheduleFlush(0);
            return;
          }
        } catch {
          try { nativeTranslator?.destroy?.(); } catch { /* optional browser API */ }
          nativeTranslator = null;
        }
      }
      await prepareBackend();
    }

    function scheduleFlush(delay = 45) {
      if (!engineReady || flushTimerRef.current || !queue.size || activeBatch.length) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        if (engine === "browser-native") runNativeQueue();
        else runBackendQueue();
      }, delay);
    }

    retryActionRef.current = () => {
      if (stopped || !failed.size) return;
      failed.forEach((item, source) => queue.set(source, { ...item, attempts: 0 }));
      failed.clear();
      publishProgress({ phase: "translating", error: "" });
      if (engineReady) scheduleFlush(0);
      else prepareEngine();
    };

    setState({
      active: true,
      translating: true,
      pending: 0,
      completed: 0,
      total: 0,
      phase: "checking",
      engine: "detecting",
      downloadProgress: null,
      error: "",
    });

    // Translate immediate labels from the bundled dictionary, collect prose
    // once, then update each waiting DOM target directly as results arrive.
    const root = document.body;
    scanDocument(root);
    observerRef.current = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") {
          const applied = textAppliedRef.current.get(mutation.target);
          if (applied && mutation.target.nodeValue === applied) return;
          scheduleScan(mutation.target);
          return;
        }
        if (mutation.type === "attributes") {
          const applied = attributeAppliedRef.current.get(mutation.target)?.get(mutation.attributeName);
          if (applied && mutation.target.getAttribute(mutation.attributeName) === applied) return;
          scheduleScan(mutation.target);
          return;
        }
        mutation.addedNodes.forEach((node) => scheduleScan(node));
      });
    });
    observerRef.current.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });
    prepareEngine();

    return () => {
      stopped = true;
      generationRef.current += 1;
      observerRef.current?.disconnect();
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      flushTimerRef.current = null;
      scanTimerRef.current = null;
      try { nativeTranslator?.destroy?.(); } catch { /* optional browser API */ }
      if (preparedNativeRef.current?.promise) preparedNativeRef.current = null;
      saveSessionCache(cacheRef.current);
    };
  }, [language, restoreEnglish]);

  const retry = useCallback(() => retryActionRef.current?.(), []);
  return { ...state, prepareBrowser, retry };
}

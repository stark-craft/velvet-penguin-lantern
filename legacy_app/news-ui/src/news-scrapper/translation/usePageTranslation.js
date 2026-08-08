import { useCallback, useEffect, useRef, useState } from "react";
import { translateToKorean } from "../api.js";
import { staticKoreanTranslation } from "./koreanDictionary.js";

export const LANGUAGE_STORAGE_KEY = "news-language";

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

function hasEnglish(value) {
  const text = String(value || "").trim();
  if (!/[A-Za-z]/.test(text) || text.length < 2) return false;
  if (/^(?:https?:\/\/|www\.|mailto:)/i.test(text)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return false;
  if (/^[A-Z0-9_.:/\\-]{2,}$/.test(text) && !/\s/.test(text)) return false;
  return true;
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

export function readStoredLanguage() {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "ko" ? "ko" : "en";
}

export function usePageTranslation(language) {
  const [state, setState] = useState({
    active: false,
    pending: 0,
    engine: "local-marian",
    error: "",
  });
  const observerRef = useRef(null);
  const generationRef = useRef(0);
  const textOriginalsRef = useRef(new Map());
  const textAppliedRef = useRef(new WeakMap());
  const attributeOriginalsRef = useRef(new Map());
  const attributeAppliedRef = useRef(new WeakMap());
  const cacheRef = useRef(new Map());
  const failedRef = useRef(new Set());
  const queueRef = useRef(new Set());
  const flushTimerRef = useRef(null);
  const scanTimerRef = useRef(null);

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
    attributeAppliedRef.current = new WeakMap();
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "ko" ? "ko" : "en";
    document.documentElement.dataset.language = language;

    if (observerRef.current) observerRef.current.disconnect();
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    flushTimerRef.current = null;
    scanTimerRef.current = null;

    if (language !== "ko") {
      queueRef.current.clear();
      failedRef.current.clear();
      restoreEnglish();
      setState((current) => ({ ...current, active: false, pending: 0, error: "" }));
      return undefined;
    }

    failedRef.current.clear();
    setState((current) => ({ ...current, active: true, error: "" }));

    const translateValue = (value) => {
      const trimmed = String(value || "").trim();
      if (!hasEnglish(trimmed)) return null;
      const instant = staticKoreanTranslation(trimmed);
      if (instant) return instant;
      const cached = cacheRef.current.get(trimmed);
      if (cached) return cached;
      if (!failedRef.current.has(trimmed)) queueRef.current.add(trimmed);
      return null;
    };

    let scanDocument = () => {};

    const flushQueue = async () => {
      if (generation !== generationRef.current || language !== "ko") return;
      const batch = Array.from(queueRef.current).slice(0, 80);
      batch.forEach((value) => queueRef.current.delete(value));
      if (!batch.length) return;
      setState((current) => ({
        ...current,
        pending: current.pending + batch.length,
        error: "",
      }));
      try {
        const response = await translateToKorean(batch);
        if (generation !== generationRef.current) return;
        (response?.translations || []).forEach((item, index) => {
          const source = String(item?.source || batch[index] || "").trim();
          const translated = String(item?.translated || "").trim();
          if (source && translated) cacheRef.current.set(source, translated);
        });
        setState((current) => ({
          ...current,
          engine: response?.engine || current.engine,
          error: "",
        }));
        scanDocument();
      } catch (error) {
        batch.forEach((value) => failedRef.current.add(value));
        setState((current) => ({
          ...current,
          error: error?.message || "Korean translation is unavailable.",
        }));
      } finally {
        setState((current) => ({
          ...current,
          pending: Math.max(0, current.pending - batch.length),
        }));
        if (queueRef.current.size && generation === generationRef.current) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushQueue();
          }, 30);
        }
      }
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current || !queueRef.current.size) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushQueue();
      }, 90);
    };

    const translateTextNode = (node) => {
      if (isSkipped(node)) return;
      const current = node.nodeValue || "";
      const lastApplied = textAppliedRef.current.get(node);
      if (lastApplied && current === lastApplied) return;
      const original = current;
      if (!hasEnglish(original)) return;
      textOriginalsRef.current.set(node, original);
      const translated = translateValue(original);
      if (!translated) return;
      const applied = preserveWhitespace(original, translated);
      textAppliedRef.current.set(node, applied);
      node.nodeValue = applied;
    };

    const translateAttributes = (element) => {
      if (!(element instanceof Element) || isSkipped(element)) return;
      const appliedForElement = attributeAppliedRef.current.get(element) || new Map();
      let originals = attributeOriginalsRef.current.get(element);
      for (const name of TRANSLATABLE_ATTRIBUTES) {
        const current = element.getAttribute(name);
        if (!current || appliedForElement.get(name) === current || !hasEnglish(current)) continue;
        if (!originals) {
          originals = new Map();
          attributeOriginalsRef.current.set(element, originals);
        }
        originals.set(name, current);
        const translated = translateValue(current);
        if (!translated) continue;
        appliedForElement.set(name, translated);
        element.setAttribute(name, translated);
      }
      attributeAppliedRef.current.set(element, appliedForElement);
    };

    scanDocument = (root = document.body) => {
      if (!root || generation !== generationRef.current) return;
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
      scheduleFlush();
    };

    const scheduleScan = (root) => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = window.setTimeout(() => {
        scanTimerRef.current = null;
        scanDocument(root?.isConnected ? root : document.body);
      }, 16);
    };

    // Article dossiers, approval dialogs, and feedback modals use React
    // portals mounted next to #root. Observe body so those surfaces switch
    // languages together with the main application.
    const root = document.body;
    scanDocument(root);
    observerRef.current = new MutationObserver((mutations) => {
      let target = null;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const applied = textAppliedRef.current.get(mutation.target);
          if (applied && mutation.target.nodeValue === applied) continue;
          target = mutation.target.parentElement || root;
          break;
        }
        if (mutation.type === "attributes") {
          const applied = attributeAppliedRef.current.get(mutation.target)?.get(mutation.attributeName);
          if (applied && mutation.target.getAttribute(mutation.attributeName) === applied) continue;
        }
        target = mutation.target;
        break;
      }
      if (target) scheduleScan(target);
    });
    if (root) {
      observerRef.current.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATABLE_ATTRIBUTES,
      });
    }

    return () => {
      generationRef.current += 1;
      observerRef.current?.disconnect();
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      flushTimerRef.current = null;
      scanTimerRef.current = null;
    };
  }, [language, restoreEnglish]);

  return state;
}

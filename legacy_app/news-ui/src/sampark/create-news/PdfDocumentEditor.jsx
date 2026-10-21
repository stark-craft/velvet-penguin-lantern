import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy,
  Download, FilePlus2, FileText, Highlighter, ImagePlus, Loader2,
  MousePointer2, Pencil, Plus, Redo2, RotateCcw, RotateCw, Save,
  Search, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { replaceContributionDocument } from '../../news-scrapper/api.js';
import './PdfDocumentEditor.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const HISTORY_LIMIT = 40;
const MAX_INLINE_IMAGE = 15 * 1024 * 1024;

const makeId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const getFilename = (source) => source?.name || 'Document.pdf';
const bytesLabel = (size) => size >= 1024 * 1024 ? (size / (1024 * 1024)).toFixed(1) + ' MB' : Math.round(size / 1024) + ' KB';
const hexRgb = (hex) => {
  const cleaned = (hex || '#1e293b').replace('#', '');
  const parsed = parseInt(cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned, 16);
  return rgb(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255);
};
const safeFontText = (value) => String(value || '').replace(/[^\x20-\x7e\n]/g, '?');
const getRotation = (page, item) => (((page?.rotate || 0) + (item?.rotation || 0)) % 360 + 360) % 360;

function Tool({ icon: Icon, label, active, onClick, disabled, title }) {
  return (
    <button type="button" className={'spdf-tool' + (active ? ' is-active' : '')}
      title={title || label} aria-pressed={Boolean(active)}
      onClick={onClick} disabled={disabled}>
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

function PageMark({ mark, selected, zoom, onSelect, onMoveStart, onMove, onMoveEnd }) {
  const style = {
    left: (mark.x * 100) + '%',
    top: (mark.y * 100) + '%',
    width: (mark.w * 100) + '%',
    height: (mark.h * 100) + '%',
    borderColor: mark.color || '#2563eb',
  };
  const isInk = mark.kind === 'ink';
  return (
    <div
      className={'spdf-mark spdf-mark--' + mark.kind + (selected ? ' is-selected' : '')}
      style={style}
      onClick={(event) => { event.stopPropagation(); onSelect(mark.id); }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onMoveStart(event, mark);
      }}
      onPointerMove={onMove}
      onPointerUp={onMoveEnd}
      onPointerCancel={onMoveEnd}
      title="Click to select, drag to reposition"
    >
      {(mark.kind === 'text' || mark.kind === 'replace') && (
        <div className="spdf-mark-text" style={{ color: mark.color, fontSize: Math.max(9, (mark.size || 13) * zoom), lineHeight: 1.2 }}>
          {mark.text || 'Text'}
        </div>
      )}
      {mark.kind === 'image' && <img draggable="false" alt="Inserted" src={mark.image} />}
      {isInk && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
          <polyline fill="none" stroke={mark.color || '#2563eb'} strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            points={(mark.points || []).map((p) => ((p.x - mark.x) / mark.w * 100) + ',' + ((p.y - mark.y) / mark.h * 100)).join(' ')}
          />
        </svg>
      )}
      {selected && <span className="spdf-mark-grip" />}
    </div>
  );
}

export default function PdfDocumentEditor({
  recordId, sourceDocument, onBack, onSaved, onDraftChange,
}) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const imageInputRef = useRef(null);
  const mergeInputRef = useRef(null);
  const sourcesRef = useRef(new Map());
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const dragRef = useRef(null);
  const drawingRef = useRef(null);
  const lastRenderRef = useRef(0);

  const [documentState, setDocumentState] = useState({ pages: [], marks: [] });
  const [pageKey, setPageKey] = useState(null);
  const [selectedMark, setSelectedMark] = useState(null);
  const [tool, setTool] = useState('select');
  const [zoom, setZoom] = useState(1.12);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageBounds, setPageBounds] = useState({ width: 612, height: 792 });
  const [textItems, setTextItems] = useState([]);
  const [thumbnails, setThumbnails] = useState({});
  const [pendingImage, setPendingImage] = useState(null);
  const [inkPoints, setInkPoints] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [search, setSearch] = useState('');

  const pages = documentState.pages;
  const marks = documentState.marks;
  const activePage = pages.find((page) => page.key === pageKey) || pages[0];
  const activeIndex = Math.max(0, pages.findIndex((page) => page.key === activePage?.key));
  const pageMarks = useMemo(() => marks.filter((mark) => mark.pageKey === activePage?.key), [marks, activePage?.key]);
  const selected = marks.find((mark) => mark.id === selectedMark);
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const change = (fn) => {
    setDocumentState((before) => {
      const after = fn(before);
      if (after === before) return before;
      undoRef.current.push(before);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      setIsDirty(true);
      return after;
    });
  };
  const changeWithoutHistory = (fn) => setDocumentState((before) => fn(before));

  const undo = () => {
    if (!undoRef.current.length) return;
    setDocumentState((current) => {
      const previous = undoRef.current.pop();
      redoRef.current.push(current);
      return previous;
    });
    setSelectedMark(null);
    setIsDirty(true);
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    setDocumentState((current) => {
      const next = redoRef.current.pop();
      undoRef.current.push(current);
      return next;
    });
    setSelectedMark(null);
    setIsDirty(true);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sourceDocument?.url) {
        setError('The original PDF URL is missing. Return to your draft and reopen Edit PDF.');
        setStatus('error');
        return;
      }
      try {
        setStatus('loading');
        const response = await fetch(sourceDocument.url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('The PDF could not be downloaded (HTTP ' + response.status + ').');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const proxy = await loadingTask.promise;
        if (cancelled) { await loadingTask.destroy(); return; }
        sourcesRef.current.set('original', { bytes, proxy, loadingTask });
        const nextPages = Array.from({ length: proxy.numPages }, (_, i) => ({
          key: makeId(), source: 'original', index: i, rotation: 0,
        }));
        setDocumentState({ pages: nextPages, marks: [] });
        setPageKey(nextPages[0]?.key || null);
        setStatus('ready');
        setError('');
      } catch (reason) {
        if (!cancelled) {
          setStatus('error');
          setError(reason?.message || 'The PDF could not be opened in the editor.');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      const values = Array.from(sourcesRef.current.values());
      sourcesRef.current.clear();
      values.forEach((source) => source.loadingTask?.destroy()?.catch?.(() => {}));
    };
  }, [sourceDocument?.url]);

  useEffect(() => {
    if (!activePage && pages.length) setPageKey(pages[0].key);
  }, [activePage, pages]);

  useEffect(() => {
    const renderId = ++lastRenderRef.current;
    let renderTask;
    async function render() {
      if (!activePage || status !== 'ready') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        let viewport;
        let text = [];
        if (activePage.blank) {
          const width = activePage.width || 595;
          const height = activePage.height || 842;
          const sideways = (activePage.rotation || 0) % 180 !== 0;
          viewport = {
            width: (sideways ? height : width) * zoom,
            height: (sideways ? width : height) * zoom,
          };
        } else {
          const source = sourcesRef.current.get(activePage.source);
          if (!source) return;
          const page = await source.proxy.getPage(activePage.index + 1);
          viewport = page.getViewport({ scale: zoom, rotation: getRotation(page, activePage) });
          if (renderId !== lastRenderRef.current) return;
          const result = await page.getTextContent();
          text = result.items.filter((item) => item.str?.trim()).slice(0, 600).map((item) => {
            const transform = pdfjs.Util.transform(viewport.transform, item.transform);
            const height = Math.max(8, Math.hypot(transform[2], transform[3]));
            return {
              id: makeId(), text: item.str,
              x: clamp(transform[4] / viewport.width, 0, 1),
              y: clamp((transform[5] - height) / viewport.height, 0, 1),
              w: clamp(Math.max(16, item.width * zoom) / viewport.width, 0.025, 1),
              h: clamp((height + 4) / viewport.height, 0.012, 0.2),
              fontSize: clamp(height / zoom, 7, 32),
            };
          });
          const scale = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.ceil(viewport.width * scale);
          canvas.height = Math.ceil(viewport.height * scale);
          canvas.style.width = viewport.width + 'px';
          canvas.style.height = viewport.height + 'px';
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, viewport.width, viewport.height);
          renderTask = page.render({ canvasContext: ctx, viewport });
          await renderTask.promise;
        }
        if (renderId !== lastRenderRef.current) return;
        if (activePage.blank) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = viewport.width + 'px';
          canvas.style.height = viewport.height + 'px';
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, viewport.width, viewport.height);
        }
        setPageBounds({ width: viewport.width, height: viewport.height });
        setTextItems(text);
      } catch (reason) {
        if (renderId === lastRenderRef.current && reason?.name !== 'RenderingCancelledException') {
          setError(reason?.message || 'This page could not be rendered.');
        }
      }
    }
    render();
    return () => {
      lastRenderRef.current += 1;
      renderTask?.cancel();
    };
  }, [activePage?.key, activePage?.rotation, zoom, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    const candidates = pages.slice(Math.max(0, activeIndex - 3), Math.min(pages.length, activeIndex + 4));
    let cancelled = false;
    (async () => {
      for (const item of candidates) {
        if (cancelled || thumbnails[item.key] || item.blank) continue;
        const source = sourcesRef.current.get(item.source);
        if (!source) continue;
        try {
          const page = await source.proxy.getPage(item.index + 1);
          const viewport = page.getViewport({ scale: 0.20, rotation: getRotation(page, item) });
          const small = document.createElement('canvas');
          small.width = Math.ceil(viewport.width);
          small.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: small.getContext('2d'), viewport }).promise;
          if (!cancelled) setThumbnails((old) => ({ ...old, [item.key]: small.toDataURL('image/jpeg', 0.65) }));
        } catch (_) {
          // The full-size page renderer will report meaningful errors.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [status, activeIndex, pages]);

  const pointFromEvent = (event) => {
    const rect = stageRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const addMark = (partial) => {
    if (!activePage) return;
    const mark = {
      id: makeId(), pageKey: activePage.key, kind: partial.kind || tool,
      x: partial.x, y: partial.y, w: partial.w || 0.24,
      h: partial.h || 0.06, color: partial.color || '#2563eb',
      size: partial.size || 13, text: partial.text || '',
      ...partial,
    };
    change((old) => ({ ...old, marks: [...old.marks, mark] }));
    setSelectedMark(mark.id);
    setTool('select');
  };

  const onStageClick = (event) => {
    if (tool === 'select' || tool === 'edit') {
      setSelectedMark(null);
      return;
    }
    if (tool === 'ink') return;
    const { x, y } = pointFromEvent(event);
    const w = Math.min(tool === 'image' ? 0.32 : 0.30, 0.98 - x);
    if (tool === 'image') {
      if (!pendingImage) { imageInputRef.current?.click(); return; }
      addMark({ kind: 'image', x, y, w, h: 0.20, image: pendingImage });
      setPendingImage(null);
    } else if (tool === 'text') {
      addMark({ kind: 'text', x, y, w, h: 0.065, text: 'Type your text here', color: '#172a45' });
    } else if (tool === 'whiteout') {
      addMark({ kind: 'whiteout', x, y, w, h: 0.06, color: '#ffffff' });
    } else if (tool === 'highlight') {
      addMark({ kind: 'highlight', x, y, w, h: 0.04, color: '#ffe16a' });
    } else if (tool === 'rectangle') {
      addMark({ kind: 'rectangle', x, y, w, h: 0.11, color: '#2563eb' });
    }
  };

  const pickOriginalText = (item) => {
    addMark({
      kind: 'replace', x: item.x, y: item.y,
      w: Math.min(item.w + 0.012, 1 - item.x),
      h: Math.min(item.h + 0.01, 1 - item.y),
      color: '#172a45', text: item.text, size: item.fontSize,
    });
    setNotice('Text replacement is visual. Original searchable text can remain inside the PDF.');
  };

  const startInk = (event) => {
    if (tool !== 'ink' || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = pointFromEvent(event);
    drawingRef.current = [p];
    setInkPoints([p]);
  };
  const moveInk = (event) => {
    if (!drawingRef.current) return;
    const points = [...drawingRef.current, pointFromEvent(event)];
    drawingRef.current = points;
    setInkPoints(points);
  };
  const endInk = (event) => {
    if (!drawingRef.current) return;
    const points = drawingRef.current;
    drawingRef.current = null;
    setInkPoints([]);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (points.length < 2) return;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(0.005, Math.max(...xs) - x);
    const h = Math.max(0.005, Math.max(...ys) - y);
    addMark({ kind: 'ink', x, y, w, h, points, color: '#2563eb' });
    setTool('ink');
  };

  const onMoveStart = (event, mark) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedMark(mark.id);
    dragRef.current = {
      id: mark.id, x: event.clientX, y: event.clientY,
      originX: mark.x, originY: mark.y,
      snapshot: documentState, moved: false,
    };
  };
  const onMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const newX = clamp(drag.originX + (event.clientX - drag.x) / bounds.width, 0, 0.99);
    const newY = clamp(drag.originY + (event.clientY - drag.y) / bounds.height, 0, 0.99);
    drag.moved = true;
    changeWithoutHistory((current) => ({
      ...current,
      marks: current.marks.map((mark) => {
        if (mark.id !== drag.id) return mark;
        const dx = clamp(newX, 0, 1 - mark.w) - mark.x;
        const dy = clamp(newY, 0, 1 - mark.h) - mark.y;
        return {
          ...mark, x: mark.x + dx, y: mark.y + dy,
          points: mark.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        };
      }),
    }));
  };
  const onMoveEnd = (event) => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      undoRef.current.push(drag.snapshot);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      setIsDirty(true);
    }
  };

  const updateMark = (patch) => {
    if (!selectedMark) return;
    change((old) => ({
      ...old,
      marks: old.marks.map((mark) => mark.id === selectedMark ? { ...mark, ...patch } : mark),
    }));
  };
  const deleteMark = () => {
    if (!selectedMark) return;
    change((old) => ({ ...old, marks: old.marks.filter((mark) => mark.id !== selectedMark) }));
    setSelectedMark(null);
  };

  const alterPage = (operation) => {
    if (!activePage) return;
    const i = activeIndex;
    if (operation === 'delete' && pages.length === 1) {
      setNotice('A PDF must have at least one page.');
      return;
    }
    let focus = activePage.key;
    change((old) => {
      const next = old.pages.slice();
      let nextMarks = old.marks;
      if (operation === 'rotate-left' || operation === 'rotate-right') {
        next[i] = { ...next[i], rotation: (next[i].rotation + (operation === 'rotate-right' ? 90 : 270)) % 360 };
      } else if (operation === 'duplicate') {
        const duplicate = { ...next[i], key: makeId() };
        next.splice(i + 1, 0, duplicate);
        nextMarks = [...nextMarks, ...old.marks.filter((mark) => mark.pageKey === activePage.key).map((mark) => ({ ...mark, id: makeId(), pageKey: duplicate.key }))];
        focus = duplicate.key;
      } else if (operation === 'delete') {
        next.splice(i, 1);
        nextMarks = nextMarks.filter((mark) => mark.pageKey !== activePage.key);
        focus = next[Math.min(i, next.length - 1)].key;
      } else if (operation === 'up' && i > 0) {
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
      } else if (operation === 'down' && i < next.length - 1) {
        [next[i + 1], next[i]] = [next[i], next[i + 1]];
      } else return old;
      return { pages: next, marks: nextMarks };
    });
    setPageKey(focus);
    setSelectedMark(null);
    setThumbnails({});
  };
  const addBlank = () => {
    const blank = { key: makeId(), blank: true, width: 595, height: 842, rotation: 0 };
    change((old) => ({ ...old, pages: [...old.pages.slice(0, activeIndex + 1), blank, ...old.pages.slice(activeIndex + 1)] }));
    setPageKey(blank.key);
    setSelectedMark(null);
  };
  const mergePdf = async (file) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF to insert pages from.');
      return;
    }
    setBusy(true); setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
      const proxy = await loadingTask.promise;
      const sourceKey = makeId();
      sourcesRef.current.set(sourceKey, { bytes, loadingTask, proxy });
      const newPages = Array.from({ length: proxy.numPages }, (_, index) => ({
        key: makeId(), source: sourceKey, index, rotation: 0,
      }));
      change((old) => ({ ...old, pages: [...old.pages, ...newPages] }));
      setPageKey(newPages[0].key);
      setNotice(proxy.numPages + ' pages inserted from ' + file.name + '.');
    } catch (reason) {
      setError(reason?.message || 'This PDF could not be merged.');
    } finally {
      setBusy(false);
      if (mergeInputRef.current) mergeInputRef.current.value = '';
    }
  };
  const addImage = (file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Choose a PNG or JPG image.');
      return;
    }
    if (file.size > MAX_INLINE_IMAGE) {
      setError('Please use an image smaller than 15 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage(String(reader.result));
      setTool('image');
      setNotice('Click the PDF page to place your image.');
    };
    reader.readAsDataURL(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const buildEditedPdf = async () => {
    if (!pages.length) throw new Error('There are no pages to save.');
    const output = await PDFDocument.create();
    const font = await output.embedFont(StandardFonts.Helvetica);
    const loaded = new Map();
    const embeddedImages = new Map();
    for (const item of pages) {
      let page;
      let viewport;
      let rotation = item.rotation || 0;
      if (item.blank) {
        page = output.addPage([item.width || 595, item.height || 842]);
        page.setRotation(degrees(rotation));
        const w = page.getWidth(), h = page.getHeight();
        viewport = {
          width: rotation % 180 ? h : w,
          height: rotation % 180 ? w : h,
          convertToPdfPoint: (x, y) => {
            if (rotation === 90) return [y, x];
            if (rotation === 180) return [w - x, y];
            if (rotation === 270) return [w - y, h - x];
            return [x, h - y];
          },
        };
      } else {
        if (!loaded.has(item.source)) {
          const info = sourcesRef.current.get(item.source);
          loaded.set(item.source, await PDFDocument.load(info.bytes, { updateMetadata: false }));
        }
        const srcDocument = loaded.get(item.source);
        const copied = await output.copyPages(srcDocument, [item.index]);
        page = copied[0];
        output.addPage(page);
        page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
        const sourcePage = await sourcesRef.current.get(item.source).proxy.getPage(item.index + 1);
        rotation = getRotation(sourcePage, item);
        viewport = sourcePage.getViewport({ scale: 1, rotation });
      }
      const currentMarks = marks.filter((mark) => mark.pageKey === item.key);
      const point = (x, y) => viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
      for (const mark of currentMarks) {
        const [x1, y1] = point(mark.x, mark.y);
        const [x2, y2] = point(mark.x + mark.w, mark.y + mark.h);
        const bounds = {
          x: Math.min(x1, x2), y: Math.min(y1, y2),
          width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
        };
        if (mark.kind === 'whiteout' || mark.kind === 'replace') {
          page.drawRectangle({ ...bounds, color: rgb(1, 1, 1) });
        }
        if (mark.kind === 'highlight') {
          page.drawRectangle({ ...bounds, color: hexRgb(mark.color || '#ffe16a'), opacity: 0.42 });
        }
        if (mark.kind === 'rectangle') {
          page.drawRectangle({ ...bounds, borderColor: hexRgb(mark.color), borderWidth: 1.8 });
        }
        if (mark.kind === 'text' || mark.kind === 'replace') {
          const text = safeFontText(mark.text);
          const fontSize = clamp(Number(mark.size) || 13, 7, 72);
          if (text.trim()) page.drawText(text, {
            x: bounds.x + 2, y: bounds.y + Math.max(0, bounds.height - fontSize - 2),
            font, size: fontSize, color: hexRgb(mark.color),
            maxWidth: Math.max(15, bounds.width - 4), lineHeight: fontSize * 1.19,
            rotate: degrees((360 - rotation) % 360),
          });
        }
        if (mark.kind === 'image' && mark.image) {
          if (!embeddedImages.has(mark.image)) {
            const bytes = await (await fetch(mark.image)).arrayBuffer();
            embeddedImages.set(mark.image,
              mark.image.startsWith('data:image/png') ? await output.embedPng(bytes) : await output.embedJpg(bytes));
          }
          page.drawImage(embeddedImages.get(mark.image), { ...bounds });
        }
        if (mark.kind === 'ink' && mark.points?.length > 1) {
          for (let j = 1; j < mark.points.length; j++) {
            const [startX, startY] = point(mark.points[j - 1].x, mark.points[j - 1].y);
            const [endX, endY] = point(mark.points[j].x, mark.points[j].y);
            page.drawLine({ start: { x: startX, y: startY }, end: { x: endX, y: endY },
              thickness: 1.7, color: hexRgb(mark.color) });
          }
        }
      }
    }
    const bytes = await output.save({ useObjectStreams: true });
    return new Blob([bytes], { type: 'application/pdf' });
  };
  const exportPdf = async (saveToSampark) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const blob = await buildEditedPdf();
      if (saveToSampark) {
        if (!recordId) throw new Error('The draft ID is missing. Reopen the editor from the saved Sampark draft.');
        const updated = await replaceContributionDocument(recordId, blob, 'edited-document.pdf');
        setIsDirty(false);
        setNotice('Your edited PDF was saved to Sampark.');
        onDraftChange?.(updated);
        onSaved?.(updated);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getFilename(sourceDocument).replace(/\.pdf$/i, '') + '-edited.pdf';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setNotice('Edited PDF downloaded to your computer.');
      }
    } catch (reason) {
      setError(reason?.message || 'The edited PDF could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const goBack = () => {
    if (isDirty && !window.confirm('Discard unsaved PDF edits and return to your draft?')) return;
    onBack?.();
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target?.isContentEditable;
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (!editing && (event.key === 'Delete' || event.key === 'Backspace') && selectedMark) {
        event.preventDefault(); deleteMark();
      } else if (event.key === 'Escape') {
        setTool('select'); setSelectedMark(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const renderTools = [
    { id: 'select', label: 'Select', icon: MousePointer2 },
    { id: 'edit', label: 'Replace text', icon: Pencil },
    { id: 'text', label: 'Add text', icon: Type },
    { id: 'whiteout', label: 'Whiteout', icon: Square },
    { id: 'highlight', label: 'Highlight', icon: Highlighter },
    { id: 'rectangle', label: 'Shape', icon: Square },
    { id: 'ink', label: 'Draw', icon: Pencil },
  ];

  return (
    <section className="spdf-workspace">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => addImage(e.target.files?.[0])} />
      <input ref={mergeInputRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => mergePdf(e.target.files?.[0])} />
      <header className="spdf-header">
        <div className="spdf-header-left">
          <button className="spdf-icon-button" type="button" onClick={goBack} title="Back to Create News"><ArrowLeft size={18} /></button>
          <div className="spdf-docsymbol"><FileText size={21} /></div>
          <div className="spdf-title-group">
            <strong>{getFilename(sourceDocument)}</strong>
            <span>PDF editing workspace <i /> {pages.length} pages {sourceDocument?.size ? '· ' + bytesLabel(sourceDocument.size) : ''}</span>
          </div>
        </div>
        <div className="spdf-header-actions">
          {isDirty && <span className="spdf-unsaved"><span /> Unsaved changes</span>}
          <button className="spdf-button spdf-button--light" type="button" disabled={busy || status !== 'ready'} onClick={() => exportPdf(false)}>
            <Download size={16} /> Export
          </button>
          <button className="spdf-button spdf-button--primary" type="button" disabled={busy || status !== 'ready' || !isDirty} onClick={() => exportPdf(true)}>
            {busy ? <Loader2 size={16} className="spdf-spin" /> : <Save size={16} />} Save to Sampark
          </button>
        </div>
      </header>

      <div className="spdf-toolbar">
        <div className="spdf-toolstrip">
          {renderTools.map((item) => <Tool key={item.id} icon={item.icon} label={item.label}
            active={tool === item.id} disabled={status !== 'ready' || busy}
            onClick={() => { setTool(item.id); setSelectedMark(null); }}
            title={item.id === 'edit' ? 'Click a text line to replace its visible appearance' : item.label} />)}
          <Tool icon={ImagePlus} label="Image" active={tool === 'image'} disabled={status !== 'ready' || busy}
            onClick={() => imageInputRef.current?.click()} />
        </div>
        <div className="spdf-toolbar-tail">
          <button type="button" className="spdf-icon-button" title="Undo (Ctrl+Z)" disabled={!canUndo || busy} onClick={undo}><Undo2 size={17} /></button>
          <button type="button" className="spdf-icon-button" title="Redo (Ctrl+Y)" disabled={!canRedo || busy} onClick={redo}><Redo2 size={17} /></button>
          <span className="spdf-toolbar-separator" />
          <button type="button" className="spdf-icon-button" title="Zoom out" onClick={() => setZoom((v) => clamp(+(v - 0.1).toFixed(2), MIN_ZOOM, MAX_ZOOM))}><ZoomOut size={17} /></button>
          <span className="spdf-zoom-value">{Math.round(zoom * 100)}%</span>
          <button type="button" className="spdf-icon-button" title="Zoom in" onClick={() => setZoom((v) => clamp(+(v + 0.1).toFixed(2), MIN_ZOOM, MAX_ZOOM))}><ZoomIn size={17} /></button>
        </div>
      </div>

      {error && <div className="spdf-alert spdf-alert--error" role="alert"><strong>PDF editor:</strong> {error} <button type="button" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="spdf-alert spdf-alert--note" role="status">{notice} <button type="button" onClick={() => setNotice('')}><X size={16} /></button></div>}

      <div className="spdf-columns">
        <aside className="spdf-pages">
          <div className="spdf-panel-heading"><span>Pages</span><strong>{pages.length}</strong></div>
          <div className="spdf-page-list">
            {pages.map((page, i) => (
              <button type="button" key={page.key}
                className={'spdf-thumb' + (activePage?.key === page.key ? ' is-current' : '')}
                onClick={() => { setPageKey(page.key); setSelectedMark(null); }}>
                <span className="spdf-thumb-paper">
                  {thumbnails[page.key] ? <img src={thumbnails[page.key]} alt="" /> : <FileText size={27} />}
                  {marks.some((mark) => mark.pageKey === page.key) && <i className="spdf-thumb-edited" />}
                </span>
                <span>Page {i + 1}{page.blank ? ' · New' : ''}</span>
              </button>
            ))}
          </div>
          <div className="spdf-page-list-footer">
            <button type="button" disabled={status !== 'ready' || busy} onClick={addBlank}><Plus size={15} /> Blank page</button>
            <button type="button" disabled={status !== 'ready' || busy} onClick={() => mergeInputRef.current?.click()}><FilePlus2 size={15} /> Add PDF</button>
          </div>
        </aside>

        <main className="spdf-stage-area">
          {status === 'loading' && <div className="spdf-empty"><Loader2 className="spdf-spin" size={31} /><strong>Preparing your PDF</strong><span>Loading pages, fonts and the editing canvas...</span></div>}
          {status === 'error' && <div className="spdf-empty"><FileText size={36} /><strong>Couldn't open this document</strong><span>{error}</span><button type="button" onClick={goBack}>Back to draft</button></div>}
          {status === 'ready' && (
            <>
              <div className="spdf-stage-topline">
                <span>{tool === 'edit' ? 'Click a text line to replace it' :
                  tool === 'image' ? 'Click on the page to place the image' :
                  tool === 'select' ? 'Select and drag your edits' :
                  tool === 'ink' ? 'Drag to draw on the page' :
                  'Click the page to add ' + tool}</span>
                <div className="spdf-page-stepper">
                  <button type="button" title="Previous page" disabled={activeIndex === 0} onClick={() => setPageKey(pages[activeIndex - 1].key)}><ChevronLeft size={16} /></button>
                  <strong>{activeIndex + 1} / {pages.length}</strong>
                  <button type="button" title="Next page" disabled={activeIndex === pages.length - 1} onClick={() => setPageKey(pages[activeIndex + 1].key)}><ChevronRight size={16} /></button>
                </div>
              </div>
              <div className="spdf-stage-scroll">
                <div className={'spdf-paper' + (tool !== 'select' ? ' is-placement' : '')}
                  ref={stageRef} style={{ width: pageBounds.width, height: pageBounds.height }}
                  onClick={onStageClick}
                  onPointerDown={startInk} onPointerMove={moveInk} onPointerUp={endInk} onPointerCancel={endInk}>
                  <canvas ref={canvasRef} className="spdf-canvas" />
                  {tool === 'edit' && textItems.map((item) => (
                    <button type="button" key={item.id} className="spdf-text-hit"
                      title={'Replace: ' + item.text}
                      style={{ left: item.x * 100 + '%', top: item.y * 100 + '%', width: item.w * 100 + '%', height: item.h * 100 + '%' }}
                      onClick={(event) => { event.stopPropagation(); pickOriginalText(item); }}>
                      <span className="spdf-sr-only">{item.text}</span>
                    </button>
                  ))}
                  {pageMarks.map((mark) => (
                    <PageMark key={mark.id} mark={mark} selected={selectedMark === mark.id}
                      zoom={zoom} onSelect={setSelectedMark}
                      onMoveStart={onMoveStart} onMove={onMove} onMoveEnd={onMoveEnd} />
                  ))}
                  {inkPoints.length > 1 && (
                    <svg className="spdf-drawing" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <polyline points={inkPoints.map((p) => (p.x * 100) + ',' + (p.y * 100)).join(' ')}
                        fill="none" stroke="#2563eb" strokeWidth="0.28" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="spdf-inspector">
          <div className="spdf-panel-heading"><span>{selected ? 'Edit element' : 'Page tools'}</span><span className="spdf-inspector-kicker">{selected ? 'SELECTED' : 'PROPERTIES'}</span></div>
          {selected ? (
            <div className="spdf-inspector-content">
              <div className="spdf-selection-title"><strong>{selected.kind === 'replace' ? 'Text replacement' : selected.kind}</strong><button type="button" onClick={() => setSelectedMark(null)} title="Deselect"><X size={16} /></button></div>
              {(selected.kind === 'text' || selected.kind === 'replace') && (
                <label className="spdf-field">Text
                  <textarea rows={6} value={selected.text || ''} onChange={(e) => updateMark({ text: e.target.value })} spellCheck />
                </label>
              )}
              {['text', 'replace', 'ink', 'highlight', 'rectangle'].includes(selected.kind) && (
                <label className="spdf-field">Color
                  <input type="color" value={selected.color || '#2563eb'} onChange={(e) => updateMark({ color: e.target.value })} />
                </label>
              )}
              {(selected.kind === 'text' || selected.kind === 'replace') && (
                <label className="spdf-field">Font size
                  <input type="number" min="7" max="72" value={selected.size || 13}
                    onChange={(e) => updateMark({ size: clamp(Number(e.target.value) || 13, 7, 72) })} />
                </label>
              )}
              <div className="spdf-field">Resize
                <div className="spdf-field-row">
                  <label>Width <input type="range" min="0.03" max="0.98" step="0.01" value={selected.w}
                    onChange={(e) => updateMark({ w: Math.min(Number(e.target.value), 1 - selected.x) })} /></label>
                  <label>Height <input type="range" min="0.02" max="0.80" step="0.01" value={selected.h}
                    onChange={(e) => updateMark({ h: Math.min(Number(e.target.value), 1 - selected.y) })} /></label>
                </div>
              </div>
              <button type="button" className="spdf-button spdf-button--danger" onClick={deleteMark}><Trash2 size={16} /> Remove element</button>
              {selected.kind === 'replace' && <p className="spdf-help">Replacement visually covers the original line. Underlying text may still be searchable. Do not use this as secure redaction.</p>}
            </div>
          ) : (
            <div className="spdf-inspector-content">
              <div className="spdf-page-summary">
                <div className="spdf-page-summary-icon"><FileText size={23} /></div>
                <strong>Page {activeIndex + 1}</strong>
                <span>{pageMarks.length} edits on this page</span>
              </div>
              <div className="spdf-inspector-label">Arrange pages</div>
              <div className="spdf-inspector-grid">
                <button type="button" onClick={() => alterPage('up')} disabled={activeIndex === 0 || busy}><ChevronUp size={17} /> Move up</button>
                <button type="button" onClick={() => alterPage('down')} disabled={activeIndex === pages.length - 1 || busy}><ChevronDown size={17} /> Move down</button>
                <button type="button" onClick={() => alterPage('rotate-left')} disabled={busy}><RotateCcw size={17} /> Rotate left</button>
                <button type="button" onClick={() => alterPage('rotate-right')} disabled={busy}><RotateCw size={17} /> Rotate right</button>
                <button type="button" onClick={() => alterPage('duplicate')} disabled={busy}><Copy size={17} /> Duplicate</button>
                <button type="button" className="is-danger" onClick={() => alterPage('delete')} disabled={busy || pages.length <= 1}><Trash2 size={17} /> Delete page</button>
              </div>
              <div className="spdf-inspector-label">Add pages</div>
              <div className="spdf-inspector-stack">
                <button type="button" onClick={addBlank} disabled={busy}><Plus size={16} /> Insert blank page</button>
                <button type="button" onClick={() => mergeInputRef.current?.click()} disabled={busy}><FilePlus2 size={16} /> Merge another PDF</button>
              </div>
              <p className="spdf-help">Edit a line by selecting <strong>Replace text</strong> above, then clicking the line on the page. To move or resize a new element, use Select and the inspector.</p>
            </div>
          )}
          <div className="spdf-inspector-bottom">
            <Search size={15} />
            <input type="number" min="1" max={pages.length || 1} value={search} placeholder="Jump to page"
              aria-label="Jump to page number" onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const i = Number(search) - 1;
                  if (pages[i]) { setPageKey(pages[i].key); setSearch(''); }
                }
              }} />
            <button type="button" onClick={() => {
              const i = Number(search) - 1;
              if (pages[i]) { setPageKey(pages[i].key); setSearch(''); }
            }}>Go</button>
          </div>
        </aside>
      </div>
      <footer className="spdf-statusbar">
        <span><i className="spdf-status-dot" /> {busy ? 'Processing PDF...' : status === 'ready' ? 'Ready to edit' : 'Loading'}</span>
        <span>Page {activeIndex + 1} of {pages.length} <b>·</b> {marks.length} changes <b>·</b> Ctrl+Z to undo</span>
        <span className="spdf-status-caveat">Visual whiteouts are not secure redactions</span>
      </footer>
    </section>
  );
}

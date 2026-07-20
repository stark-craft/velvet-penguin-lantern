"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Priority, Signal } from "@/types/news";

export function Icon({ children }: { children: ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // External publisher images cannot use the framework image optimizer safely.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || "/og.png"} alt={alt} className={className} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied === "true") return; image.dataset.fallbackApplied = "true"; image.src = "/og.png"; }} />;
}

type TooltipState = { text: string; x: number; y: number; side: "top" | "bottom" } | null;
const GLOBAL_TOOLTIP_ID = "signalroom-global-tooltip";

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const timer = useRef<number | null>(null);
  const activeTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const selector = "[data-tooltip], button[aria-label]";
    const clearTimer = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
    const unlink = (target: HTMLElement | null) => {
      if (!target) return;
      const ids = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== GLOBAL_TOOLTIP_ID);
      if (ids.length) target.setAttribute("aria-describedby", ids.join(" ")); else target.removeAttribute("aria-describedby");
    };
    const hide = () => { clearTimer(); unlink(activeTrigger.current); activeTrigger.current = null; setTooltip(null); };
    const show = (target: HTMLElement, immediate = false) => {
      const text = target.dataset.tooltip || target.getAttribute("aria-label");
      if (!text) return;
      const forced = Boolean(target.dataset.tooltip) || target.matches(".icon-button, .selection-compact, .view-switch button, .sidebar-collapsed .nav-group button, .sidebar-collapsed .sidebar-toggle");
      if (!forced && (target.innerText || "").trim().length > 3) return;
      clearTimer();
      if (activeTrigger.current !== target) unlink(activeTrigger.current);
      activeTrigger.current = target;
      timer.current = window.setTimeout(() => {
        if (activeTrigger.current !== target) return;
        const rect = target.getBoundingClientRect();
        const side = rect.top < 64 ? "bottom" : "top";
        const describedBy = new Set((target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
        describedBy.add(GLOBAL_TOOLTIP_ID);
        target.setAttribute("aria-describedby", [...describedBy].join(" "));
        setTooltip({ text, x: Math.max(12, Math.min(window.innerWidth - 12, rect.left + rect.width / 2)), y: side === "top" ? rect.top - 10 : rect.bottom + 10, side });
      }, immediate ? 60 : 320);
    };
    const findTrigger = (event: Event) => (event.target as HTMLElement | null)?.closest<HTMLElement>(selector) ?? null;
    const onPointerOver = (event: PointerEvent) => { if (window.matchMedia("(hover: none)").matches) return; const target = findTrigger(event); if (target) show(target); };
    const onPointerOut = (event: PointerEvent) => { const target = findTrigger(event); if (target && !target.contains(event.relatedTarget as Node | null)) hide(); };
    const onFocusIn = (event: FocusEvent) => { const target = findTrigger(event); if (target) show(target, true); };
    const onFocusOut = (event: FocusEvent) => { const target = findTrigger(event); if (target && !target.contains(event.relatedTarget as Node | null)) hide(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tooltip) return null;
  return <div id={GLOBAL_TOOLTIP_ID} className="global-tooltip" role="tooltip" data-side={tooltip.side} style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>;
}

export function SourceBadge({ code, name }: { code: string; name?: string }) {
  return <span className="source-badge" aria-label={name ? `Source: ${name}` : undefined}>{code}</span>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <StatusBadge tone={priority}>{priority}</StatusBadge>;
}

export function SignalBadge({ signal }: { signal: Signal }) {
  const labels = { opportunity: "↗ Opportunity", risk: "! Risk", mixed: "↕ Mixed impact", neutral: "— Neutral" };
  return <StatusBadge tone={signal}>{labels[signal]}</StatusBadge>;
}

export function ScoreRing({ value, label = "Relevance" }: { value: number; label?: string }) {
  return (
    <span className="score-ring" style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties} aria-label={`${label} ${value}%`}>
      <span>{value}</span>
    </span>
  );
}

export function ArticleSelectionToggle({ checked, label, onChange, compact = false }: { checked: boolean; label: string; onChange: () => void; compact?: boolean }) {
  return <button type="button" className={`selection-toggle ${checked ? "checked" : ""} ${compact ? "selection-compact" : ""}`} aria-pressed={checked} aria-label={`${checked ? "Remove" : "Add"} ${label} ${checked ? "from" : "to"} export selection`} onClick={onChange}><span>{checked ? "✓" : ""}</span><b>{checked ? "Selected" : "Select"}</b></button>;
}

export function EmptyState({ icon = "⌁", title, copy, action }: { icon?: string; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  className = "",
  dialogId,
  initialFocus,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  dialogId?: string;
  initialFocus?: React.RefObject<HTMLElement | null>;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const headingId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const returnFocusTarget = returnFocus?.current;
    const timer = window.setTimeout(() => {
      initialFocus?.current?.focus();
      if (!initialFocus?.current) {
        modalRef.current?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
      }
    }, 0);
    document.body.classList.add("overlay-open");

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusables = Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("overlay-open");
      const target = returnFocusTarget ?? previous;
      window.setTimeout(() => target?.focus(), 0);
    };
  }, [open, initialFocus, returnFocus]);

  if (!open) return null;
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div id={dialogId} ref={modalRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="modal-header">
          <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={headingId}>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon>×</Icon></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  label,
  children,
  footer,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} eyebrow={label} className={`drawer ${className}`} footer={footer}>
      {children}
    </Modal>
  );
}

export function ToastRegion({ toasts, dismiss }: { toasts: { id: number; message: string; tone?: string }[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone ?? "neutral"}`} key={toast.id}>
          <span aria-hidden="true">{toast.tone === "success" ? "✓" : toast.tone === "warning" ? "!" : "●"}</span>
          <span>{toast.message}</span>
          <button onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">×</button>
        </div>
      ))}
    </div>
  );
}

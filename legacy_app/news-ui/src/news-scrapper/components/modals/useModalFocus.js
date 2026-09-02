import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function useModalFocus(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    const isolatedNodes = [];
    document.documentElement.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    // Isolate every sibling branch between the dialog and <body>. This works
    // for both body portals and the older inline overlays without ever making
    // the dialog's own ancestor inert.
    let activeBranch = dialog;
    while (activeBranch?.parentElement && activeBranch.parentElement !== document.documentElement) {
      const parent = activeBranch.parentElement;
      [...parent.children].forEach((node) => {
        if (node === activeBranch || node.contains(activeBranch)) return;
        isolatedNodes.push({
          node,
          hadInert: node.hasAttribute('inert'),
          ariaHidden: node.getAttribute('aria-hidden'),
        });
        node.setAttribute('inert', '');
        node.setAttribute('aria-hidden', 'true');
      });
      if (parent === document.body) break;
      activeBranch = parent;
    }
    const timer = window.requestAnimationFrame(() => {
      const preferred = dialog?.querySelector('[autofocus], input, button');
      (preferred || dialog)?.focus?.();
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)]
        .filter((element) => !element.hidden && element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      isolatedNodes.forEach(({ node, hadInert, ariaHidden }) => {
        if (!hadInert) node.removeAttribute('inert');
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      previousFocus?.focus?.();
    };
  }, [open]);

  return dialogRef;
}

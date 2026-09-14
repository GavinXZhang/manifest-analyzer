import { useCallback, useEffect, useRef } from 'react';

/**
 * One shared tooltip element for every chart on the page (the legacy app did
 * the same). Charts call `show(e, text)` on mousemove and `hide()` on leave.
 */
let el: HTMLDivElement | null = null;

function tip(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'chart-tip';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

export function useTooltip() {
  const active = useRef(false);
  const show = useCallback((e: { clientX: number; clientY: number }, text: string) => {
    const t = tip();
    t.textContent = text;
    t.style.display = 'block';
    const w = t.offsetWidth;
    const x = e.clientX + 14 + w > window.innerWidth ? e.clientX - 14 - w : e.clientX + 14;
    t.style.left = `${x}px`;
    t.style.top = `${e.clientY + 14}px`;
    active.current = true;
  }, []);
  const hide = useCallback(() => {
    if (el) el.style.display = 'none';
    active.current = false;
  }, []);
  useEffect(() => hide, [hide]);
  return { show, hide };
}

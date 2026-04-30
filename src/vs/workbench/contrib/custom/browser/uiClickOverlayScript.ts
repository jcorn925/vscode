/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type UiClickOverlayMessage = {
	type: 'vscode-ui-click';
	timestamp: number;
	href: string;
	target: {
		tag: string;
		id?: string;
		className?: string;
		name?: string;
		role?: string;
		ariaLabel?: string;
		text?: string;
	};
	source?: string;
	path?: string;
};

/**
 * Script intended to run in an embedded UI surface (e.g. iframe).
 *
 * It captures click events, extracts lightweight DOM metadata, and sends it to
 * the host via window.postMessage.
 */
export function createUiClickOverlayScript(): string {
	// Keep as a single string so it can be injected via <script> or executeJavaScript.
	return String.raw`(() => {
  const MAX_TEXT = 80;

  function safeString(v) {
    return typeof v === 'string' ? v : undefined;
  }

  function truncate(s) {
    if (!s) { return undefined; }
    const t = s.trim().replace(/\s+/g, ' ');
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
  }

  function pickSource(el) {
    if (!el) { return undefined; }
    if (el.dataset && typeof el.dataset.source === 'string' && el.dataset.source) {
      return el.dataset.source;
    }
    const attr = el.getAttribute && (el.getAttribute('data-source') || el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (attr) { return attr; }
    return undefined;
  }

  function cssPath(el) {
    try {
      const parts = [];
      let cur = el;
      for (let i = 0; cur && i < 6; i++) {
        const tag = (cur.tagName || '').toLowerCase();
        if (!tag) { break; }
        let part = tag;
        if (cur.id) {
          part += '#' + cur.id;
          parts.unshift(part);
          break;
        }
        const cls = typeof cur.className === 'string' ? cur.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
        if (cls.length) {
          part += '.' + cls.join('.');
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ') || undefined;
    } catch {
      return undefined;
    }
  }

  function extractTarget(e) {
    const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    if (!el) { return undefined; }

    const tag = safeString(el.tagName)?.toLowerCase() ?? 'unknown';
    const role = safeString(el.getAttribute && el.getAttribute('role')) || undefined;
    const name = safeString(el.getAttribute && el.getAttribute('name')) || undefined;
    const ariaLabel = safeString(el.getAttribute && el.getAttribute('aria-label')) || undefined;
    const id = safeString(el.id) || undefined;
    const className = safeString(typeof el.className === 'string' ? el.className : undefined) || undefined;
    const text = truncate(el.innerText || el.textContent || '');

    return { el, meta: { tag, role, name, ariaLabel, id, className, text } };
  }

  function onClick(ev) {
    const extracted = extractTarget(ev);
    if (!extracted) { return; }
    const { el, meta } = extracted;

    const payload = {
      type: 'vscode-ui-click',
      timestamp: Date.now(),
      href: String(location.href),
      target: meta,
      source: pickSource(el),
      path: cssPath(el)
    };

    // Send to host. In iframe contexts, parent should receive this.
    try { window.parent?.postMessage(payload, '*'); } catch {}
  }

  // Capture phase so we see events before apps stopPropagation().
  window.addEventListener('click', onClick, true);
})();`;
}


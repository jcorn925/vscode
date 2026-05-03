/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type UiClickOverlayClickMessage = {
	type: 'vscode-ui-click';
	timestamp: number;
	href: string;
	/** Set when Shift was held (used by the host for “go to source” gestures). */
	modifiers?: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
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
	/** From `data-vscode-src` (Babel / Vite); `relative/path:line:col` under the app root. */
	vscodeSrc?: string;
	path?: string;
};

export type UiClickOverlayEnvMessage = {
	type: 'vscode-ui-env';
	timestamp: number;
	href: string;
	framework?: string;
	hasVscodeSrc?: boolean;
	vscodeSrcElements?: number;
};

/** Drag-marquee selection of elements that carry data-vscode-src. */
export type UiClickOverlaySelectionMessage = {
	type: 'vscode-ui-selection';
	timestamp: number;
	href: string;
	items: readonly { readonly vscodeSrc: string; readonly tag?: string; readonly text?: string }[];
};

export type UiClickOverlayMessage = UiClickOverlayClickMessage | UiClickOverlayEnvMessage | UiClickOverlaySelectionMessage;

/**
 * Script intended to run in an embedded UI surface (e.g. iframe).
 *
 * It captures click events, extracts lightweight DOM metadata, and sends it to
 * the host via window.postMessage.
 */
/** Clears in-page marquee + mapped highlights (run inside embedded UI). */
export function createClearUiMappedSelectionScript(): string {
	return String.raw`(() => {
	try {
		document.querySelectorAll('.__vscode_mapped_selected').forEach(function (n) { n.classList.remove('__vscode_mapped_selected'); });
		document.querySelectorAll('#__vscode_marquee_box').forEach(function (n) { n.remove(); });
		document.documentElement.classList.remove('__vscode_marquee_dragging');
	} catch {
		// ignore
	}
})();`;
}

export function createUiClickOverlayScript(): string {
	// Keep as a single string so it can be injected via <script> or executeJavaScript.
	return String.raw`(() => {
const MAX_TEXT = 80;

try {
	// Avoid double-injecting.
	if (window.__vscodeClickOverlayInjected) {
		return;
	}
	window.__vscodeClickOverlayInjected = true;
} catch {
	// ignore
}

function safeString(v) {
	return typeof v === 'string' ? v : undefined;
}

function truncate(s) {
	if (!s) { return undefined; }
	const t = s.trim().replace(/\s+/g, ' ');
	return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

function pickSource(el) {
	try {
		let cur = el;
		for (let i = 0; cur && i < 8; i++) {
			if (cur.dataset && typeof cur.dataset.source === 'string' && cur.dataset.source) {
				return cur.dataset.source;
			}
			const attr = cur.getAttribute && (cur.getAttribute('data-source') || cur.getAttribute('data-testid') || cur.getAttribute('data-test-id'));
			if (attr) { return attr; }
			cur = cur.parentElement;
		}
	} catch {
		// ignore
	}
	return undefined;
}

function pickVscodeSrc(el) {
	try {
		let cur = el;
		for (let i = 0; cur && i < 8; i++) {
			if (cur.dataset && typeof cur.dataset.vscodeSrc === 'string' && cur.dataset.vscodeSrc) {
				return cur.dataset.vscodeSrc;
			}
			const attr = cur.getAttribute && cur.getAttribute('data-vscode-src');
			if (attr) { return attr; }
			cur = cur.parentElement;
		}
	} catch {
		// ignore
	}
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

function sendToHost(payload) {
	// Preferred: iframe contexts can talk to their parent.
	// In <webview>, window.parent may exist but does not bridge to the host, so only
	// use postMessage when we're actually framed.
	try {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage(payload, '*');
			return;
		}
	} catch {
		// ignore
	}

	// Fallback: desktop <webview> has no parent postMessage bridge by default.
	// Emit a console marker that the host can parse from 'console-message' events.
	try {
		console.log('__VSCODE_UI_CLICK__' + JSON.stringify(payload));
	} catch {
		// ignore
	}
}

function sendEnvToHost(payload) {
	try {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage(payload, '*');
			return;
		}
	} catch {
		// ignore
	}

	try {
		console.log('__VSCODE_UI_ENV__' + JSON.stringify(payload));
	} catch {
		// ignore
	}
}

function sendSelectionToHost(payload) {
	try {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage(payload, '*');
			return;
		}
	} catch {
		// ignore
	}

	try {
		console.log('__VSCODE_UI_SELECTION__' + JSON.stringify(payload));
	} catch {
		// ignore
	}
}

function guessFramework() {
	try {
		if (typeof window.__NEXT_DATA__ !== 'undefined') { return 'next'; }
		const scripts = document.querySelectorAll && document.querySelectorAll('script[src]');
		if (scripts) {
			for (const s of scripts) {
				const src = s && s.getAttribute && s.getAttribute('src');
				if (src && src.includes('/_next/')) { return 'next'; }
				if (src && src.includes('/@vite/')) { return 'vite'; }
			}
		}
		// Heuristic: Vite React preamble
		if (typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined') { return 'vite'; }
	} catch {
		// ignore
	}
	return undefined;
}

function emitEnvOnce() {
	try {
		if (window.__vscodeClickOverlayEnvEmitted) { return; }
		window.__vscodeClickOverlayEnvEmitted = true;
	} catch {
		// ignore
	}

	let count = 0;
	try {
		const nodes = document.querySelectorAll ? document.querySelectorAll('[data-vscode-src]') : undefined;
		count = nodes ? nodes.length : 0;
	} catch {
		// ignore
	}

	sendEnvToHost({
		type: 'vscode-ui-env',
		timestamp: Date.now(),
		href: String(location.href),
		framework: guessFramework(),
		hasVscodeSrc: count > 0,
		vscodeSrcElements: count
	});
}

function onClick(ev) {
	const extracted = extractTarget(ev);
	if (!extracted) { return; }
	const { el, meta } = extracted;

	const payload = {
		type: 'vscode-ui-click',
		timestamp: Date.now(),
		href: String(location.href),
		modifiers: {
			shiftKey: !!ev.shiftKey,
			altKey: !!ev.altKey,
			ctrlKey: !!ev.ctrlKey,
			metaKey: !!ev.metaKey
		},
		target: meta,
		source: pickSource(el),
		vscodeSrc: pickVscodeSrc(el),
		path: cssPath(el)
	};

	sendToHost(payload);
}

const DRAG_THRESHOLD_PX = 6;

function rectIntersects(a, b) {
	return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function ensureMarqueeStyles() {
	if (document.getElementById('__vscode_overlay_marquee_styles')) { return; }
	const s = document.createElement('style');
	s.id = '__vscode_overlay_marquee_styles';
	s.textContent = '.__vscode_mapped_selected{outline:2px solid #58a6ff!important;outline-offset:2px!important;box-shadow:0 0 0 1px rgba(88,166,255,0.35)!important;}#__vscode_marquee_box{position:fixed;border:1px solid #58a6ff;background:rgba(88,166,255,0.12);z-index:2147483646;pointer-events:none;}html.__vscode_marquee_dragging,html.__vscode_marquee_dragging *{-webkit-user-select:none!important;user-select:none!important;}';
	document.head.appendChild(s);
}

function clearMappedSelectionClass() {
	try {
		document.querySelectorAll('.__vscode_mapped_selected').forEach(function (n) { n.classList.remove('__vscode_mapped_selected'); });
	} catch {
		// ignore
	}
}

function collectMappedInRect(selRect) {
	const hits = [];
	const seen = new Set();
	let nodes;
	try {
		nodes = document.querySelectorAll('[data-vscode-src]');
	} catch {
		return hits;
	}
	nodes.forEach(function (node) {
		if (!node || node.nodeType !== 1) { return; }
		let r;
		try { r = node.getBoundingClientRect(); } catch { return; }
		const br = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		if (!rectIntersects(br, selRect)) { return; }
		try { node.classList.add('__vscode_mapped_selected'); } catch { /* ignore */ }
		const vs = pickVscodeSrc(node);
		if (vs && !seen.has(vs)) {
			seen.add(vs);
			hits.push({ vscodeSrc: vs, tag: String(node.tagName || '').toLowerCase(), text: truncate(node.innerText || node.textContent || '') });
		}
	});
	return hits;
}

let dragState = null;

function onMarqueeMouseMove(ev) {
	if (!dragState) { return; }
	const dx = ev.clientX - dragState.x0;
	const dy = ev.clientY - dragState.y0;
	if (!dragState.active && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
		dragState.active = true;
		ensureMarqueeStyles();
		try { document.documentElement.classList.add('__vscode_marquee_dragging'); } catch { /* ignore */ }
		dragState.marquee = document.createElement('div');
		dragState.marquee.id = '__vscode_marquee_box';
		document.body.appendChild(dragState.marquee);
		clearMappedSelectionClass();
	}
	if (!dragState.active || !dragState.marquee) { return; }
	const x1 = dragState.x0;
	const y1 = dragState.y0;
	const x2 = ev.clientX;
	const y2 = ev.clientY;
	const left = Math.min(x1, x2);
	const top = Math.min(y1, y2);
	const w = Math.abs(x2 - x1);
	const h = Math.abs(y2 - y1);
	const m = dragState.marquee;
	m.style.left = left + 'px';
	m.style.top = top + 'px';
	m.style.width = w + 'px';
	m.style.height = h + 'px';
	if (w < 2 || h < 2) { return; }
	const selRect = { left: left, top: top, right: left + w, bottom: top + h };
	clearMappedSelectionClass();
	dragState.lastHits = collectMappedInRect(selRect);
}

function onMarqueeMouseUp(ev) {
	window.removeEventListener('mousemove', onMarqueeMouseMove, true);
	window.removeEventListener('mouseup', onMarqueeMouseUp, true);
	if (!dragState) { return; }
	const st = dragState;
	dragState = null;
	try { document.documentElement.classList.remove('__vscode_marquee_dragging'); } catch { /* ignore */ }
	if (st.marquee) {
		try { st.marquee.remove(); } catch { /* ignore */ }
	}
	if (st.active) {
		const hits = st.lastHits || [];
		sendSelectionToHost({ type: 'vscode-ui-selection', timestamp: Date.now(), href: String(location.href), items: hits });
		const blockClick = function (e) {
			window.removeEventListener('click', blockClick, true);
			e.stopPropagation();
			e.preventDefault();
		};
		window.addEventListener('click', blockClick, true);
	}
}

function onMarqueeMouseDown(ev) {
	if (ev.button !== 0) { return; }
	const t = ev.target;
	if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) { return; }
	dragState = { x0: ev.clientX, y0: ev.clientY, active: false, marquee: null, lastHits: [] };
	window.addEventListener('mousemove', onMarqueeMouseMove, true);
	window.addEventListener('mouseup', onMarqueeMouseUp, true);
}

// Capture phase so we see events before apps stopPropagation().
window.addEventListener('click', onClick, true);
window.addEventListener('mousedown', onMarqueeMouseDown, true);
emitEnvOnce();
})();`;
}


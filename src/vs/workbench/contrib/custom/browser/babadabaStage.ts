/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';

/**
 * Lifecycle state of the Babadaba stage — the workspace presence band that sits
 * above the Surfaces section in the Console.
 */
export type BabadabaStageState = 'idle' | 'building' | 'complete';

/** State of one node orbiting the character on the hub. */
export type BabadabaNodeState = 'idle' | 'active' | 'building' | 'attention';

/**
 * One system Babadaba manages: a surface, or an integration such as Docker,
 * Ix graph mapping, GitHub, or Vercel. Rendered as a chip on the floor orbit
 * with an edge back to the character.
 */
export interface IBabadabaStageNode {
	readonly id: string;
	readonly label: string;
	readonly state: BabadabaNodeState;
	/** 0–100; surfaces show it as a thin bar inside the chip. */
	readonly progress?: number;
	/** Tooltip detail, e.g. the current plan step or deploy target. */
	readonly detail?: string;
	/** Click-through; omitted nodes render as passive chips. */
	readonly open?: () => void;
}

/** Snapshot the stage renders from; derived from the same progress model as the surface cards. */
export interface IBabadabaStageStatus {
	readonly state: BabadabaStageState;
	readonly surfaceCount: number;
	readonly completeCount: number;
	/** Current workflow step display label (journey strip wording). */
	readonly stepLabel?: string;
	/** Systems to render on the orbit, in display order. */
	readonly nodes?: readonly IBabadabaStageNode[];
}

/**
 * Derives the next stage state from workspace signals. `complete` is only entered
 * on the transition out of `building`, so the one-shot completion pulse fires
 * exactly once per build cycle (a reload lands in `idle`, not a re-celebration).
 */
export function deriveBabadabaStageState(
	previous: BabadabaStageState,
	anySurfaceBuilding: boolean,
	allSurfacesComplete: boolean,
): BabadabaStageState {
	if (anySurfaceBuilding) {
		return 'building';
	}
	if (allSurfacesComplete && (previous === 'building' || previous === 'complete')) {
		return 'complete';
	}
	return 'idle';
}

export interface IBabadabaOrbitPoint {
	readonly x: number;
	readonly y: number;
	/** 1 = front (nearest the viewer), 0 = behind the character. */
	readonly depth: number;
}

/**
 * Places `count` nodes on the floor ellipse around the character. The first
 * node lands front-center and the rest walk the ellipse, so surfaces (listed
 * first) take the near, most readable spots while integrations recede.
 */
export function layoutBabadabaOrbit(count: number, width: number, height: number): IBabadabaOrbitPoint[] {
	const cx = width / 2;
	const cy = height * 0.44;
	const radiusX = Math.min(Math.max(width * 0.30, 150), 430);
	const radiusY = height * 0.21;
	const points: IBabadabaOrbitPoint[] = [];
	for (let i = 0; i < count; i++) {
		const angle = Math.PI / 2 + (i / Math.max(1, count)) * Math.PI * 2;
		const depth = (Math.sin(angle) + 1) / 2;
		// The back arc bows outward and lifts a touch so chips clear the
		// character's head instead of perching beside it at narrow widths.
		const backness = 1 - depth;
		const x = cx + Math.cos(angle) * radiusX * (1 + backness * 0.45);
		points.push({
			x: Math.min(Math.max(x, 70), width - 70),
			y: cy + Math.sin(angle) * radiusY + height * 0.10 - backness * 8,
			depth,
		});
	}
	return points;
}

/** Status line for the stage copy block. */
function babadabaStageStatusLabel(status: IBabadabaStageStatus): string {
	if (status.state === 'building') {
		return localize('babadabaStage.statusBuilding', "Building surfaces — {0} of {1} complete", status.completeCount, status.surfaceCount);
	}
	if (status.state === 'complete') {
		return localize('babadabaStage.statusComplete', "All {0} surfaces complete", status.surfaceCount);
	}
	if (status.surfaceCount > 0 && status.completeCount >= status.surfaceCount) {
		return status.surfaceCount === 1
			? localize('babadabaStage.statusOneComplete', "1 surface — complete")
			: localize('babadabaStage.statusAllComplete', "{0} surfaces — all complete", status.surfaceCount);
	}
	return status.surfaceCount === 1
		? localize('babadabaStage.statusOne', "1 surface")
		: localize('babadabaStage.statusMany', "{0} surfaces", status.surfaceCount);
}

interface IStageColors {
	readonly foreground: string;
	readonly accent: string;
}

interface IDustMote {
	x: number;
	y: number;
	/** Depth, far (0.3) → near (1). Drives size, alpha, and parallax. */
	z: number;
	drift: number;
	phase: number;
}

interface IChipEntry {
	readonly element: HTMLButtonElement;
	node: IBabadabaStageNode;
	point: IBabadabaOrbitPoint;
}

/**
 * Babadaba — the workspace manager. A dark glass pebble at the center of the
 * systems it runs: surfaces and integrations orbit it on an implied floor,
 * each tethered by an edge that carries state (faint at rest, accented when
 * active, flowing while building). Idle it breathes; while surfaces build its
 * eyes narrow; when the build finishes the floor pulses once. All colors come
 * from theme tokens; all motion is slow, damped, and honors reduced motion.
 */
export class BabadabaStage extends Disposable {

	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D | null;
	private readonly statusEl: HTMLElement;
	private readonly stepEl: HTMLElement;
	private readonly nodesLayer: HTMLElement;
	private readonly chipListeners = this._register(new DisposableStore());
	private readonly chips = new Map<string, IChipEntry>();

	private status: IBabadabaStageStatus = { state: 'idle', surfaceCount: 0, completeCount: 0 };

	private width = 0;
	private height = 0;
	private colors: IStageColors | undefined;

	private time = 0;
	private lastFrame = 0;
	private frameHandle: number | undefined;

	// Pointer, normalized to [-0.5, 0.5] around the stage center; smoothed each frame.
	private pointerX = 0;
	private pointerY = 0;
	private pointerTargetX = 0;
	private pointerTargetY = 0;

	private tilt = 0;
	private riseY = 0;
	private riseVy = 0;
	private rimPulse = 0;
	private blinkAt = 3000;
	private blinkElapsed = -1;
	private ringElapsed = -1;
	private readonly dust: IDustMote[] = [];

	constructor(
		private readonly container: HTMLElement,
		private readonly isMotionReduced: () => boolean,
		resizeObserverCtor: typeof ResizeObserver = getWindow(container).ResizeObserver,
	) {
		super();

		this.canvas = $('canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
		this.ctx = this.canvas.getContext('2d');
		this.statusEl = $('div.custom-mode-ui-babadaba-stage-status');
		this.stepEl = $('div.custom-mode-ui-babadaba-stage-step');
		this.nodesLayer = $('div.custom-mode-ui-babadaba-stage-nodes');
		container.append(
			this.canvas,
			$('div.custom-mode-ui-babadaba-stage-copy', undefined,
				// Brand name — not localized, like the product name.
				$('div.custom-mode-ui-babadaba-stage-wordmark', undefined, 'Babadaba'),
				this.stepEl,
				this.statusEl,
			),
			this.nodesLayer,
		);

		const observer = new resizeObserverCtor(() => this.layout());
		observer.observe(container);
		this._register(toDisposable(() => observer.disconnect()));

		this._register(addDisposableListener(container, 'pointermove', (e: PointerEvent) => {
			const rect = container.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				this.pointerTargetX = (e.clientX - rect.left) / rect.width - 0.5;
				this.pointerTargetY = (e.clientY - rect.top) / rect.height - 0.5;
			}
		}));
		this._register(addDisposableListener(container, 'pointerleave', () => {
			this.pointerTargetX = 0;
			this.pointerTargetY = 0;
		}));

		this._register(toDisposable(() => {
			if (this.frameHandle !== undefined) {
				getWindow(container).cancelAnimationFrame(this.frameHandle);
				this.frameHandle = undefined;
			}
		}));

		this.layout();
		this.scheduleFrame();
	}

	/** Feed the stage the latest workspace snapshot; enters states and fires one-shots. */
	setStatus(status: IBabadabaStageStatus): void {
		const entering = status.state !== this.status.state ? status.state : undefined;
		this.status = status;
		this.statusEl.textContent = babadabaStageStatusLabel(status);
		this.stepEl.textContent = status.stepLabel ?? '';
		this.stepEl.classList.toggle('hidden', !status.stepLabel);
		this.renderNodes(status.nodes ?? []);
		if (entering === 'complete') {
			this.ringElapsed = 0;
			this.riseVy = -0.09;
		}
		if (this.isMotionReduced()) {
			this.draw(0);
		}
	}

	/** Re-read theme token colors (call on color theme change). */
	refreshTheme(): void {
		this.colors = undefined;
		if (this.isMotionReduced()) {
			this.draw(0);
		}
	}

	private renderNodes(nodes: readonly IBabadabaStageNode[]): void {
		const seen = new Set<string>();
		let structureChanged = false;
		for (const node of nodes) {
			seen.add(node.id);
			const existing = this.chips.get(node.id);
			if (existing) {
				existing.node = node;
				this.updateChip(existing.element, node);
			} else {
				structureChanged = true;
			}
		}
		for (const [id, entry] of this.chips) {
			if (!seen.has(id)) {
				entry.element.remove();
				this.chips.delete(id);
				structureChanged = true;
			}
		}
		if (structureChanged || nodes.length !== this.chips.size) {
			this.rebuildChips(nodes);
		}
		this.positionChips(nodes);
	}

	private rebuildChips(nodes: readonly IBabadabaStageNode[]): void {
		this.chipListeners.clear();
		this.nodesLayer.replaceChildren();
		this.chips.clear();
		for (const node of nodes) {
			const element = $('button.custom-mode-ui-babadaba-stage-node', { type: 'button' }) as HTMLButtonElement;
			element.append(
				$('span.custom-mode-ui-babadaba-stage-node-dot'),
				$('span.custom-mode-ui-babadaba-stage-node-label', undefined, node.label),
			);
			this.updateChip(element, node);
			this.chipListeners.add(addDisposableListener(element, 'click', () => this.chips.get(node.id)?.node.open?.()));
			this.nodesLayer.appendChild(element);
			this.chips.set(node.id, { element, node, point: { x: 0, y: 0, depth: 1 } });
		}
	}

	private updateChip(element: HTMLButtonElement, node: IBabadabaStageNode): void {
		element.classList.toggle('is-active', node.state === 'active');
		element.classList.toggle('is-building', node.state === 'building');
		element.classList.toggle('is-attention', node.state === 'attention');
		element.classList.toggle('is-passive', !node.open);
		element.disabled = !node.open;
		element.title = node.detail ?? node.label;
		const stateLabel = node.state === 'building'
			? localize('babadabaStage.nodeBuilding', "{0} — building", node.label)
			: node.state === 'active'
				? localize('babadabaStage.nodeActive', "{0} — active", node.label)
				: node.state === 'attention'
					? localize('babadabaStage.nodeAttention', "{0} — needs attention", node.label)
					: node.label;
		element.setAttribute('aria-label', stateLabel);
		element.style.setProperty('--babadaba-node-progress', `${Math.max(0, Math.min(100, node.progress ?? 0))}%`);
		element.classList.toggle('has-progress', typeof node.progress === 'number');
	}

	private positionChips(nodes: readonly IBabadabaStageNode[]): void {
		if (!this.width || !this.height) {
			return;
		}
		const points = layoutBabadabaOrbit(nodes.length, this.width, this.height);
		nodes.forEach((node, i) => {
			const entry = this.chips.get(node.id);
			if (!entry) {
				return;
			}
			entry.point = points[i];
			entry.element.style.left = `${points[i].x}px`;
			entry.element.style.top = `${points[i].y}px`;
			entry.element.classList.toggle('is-far', points[i].depth < 0.5);
		});
	}

	private layout(): void {
		const win = getWindow(this.container);
		const dpr = Math.min(win.devicePixelRatio || 1, 2);
		this.width = this.container.clientWidth;
		this.height = this.container.clientHeight;
		this.canvas.width = Math.round(this.width * dpr);
		this.canvas.height = Math.round(this.height * dpr);
		this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.seedDust();
		this.positionChips(this.status.nodes ?? []);
		if (this.isMotionReduced()) {
			this.draw(0);
		}
	}

	private seedDust(): void {
		this.dust.length = 0;
		const count = Math.round(this.width / 34);
		for (let i = 0; i < count; i++) {
			this.dust.push({
				x: Math.random() * this.width,
				y: Math.random() * this.height,
				z: 0.3 + Math.random() * 0.7,
				drift: 2 + Math.random() * 5,
				phase: Math.random() * Math.PI * 2,
			});
		}
	}

	private scheduleFrame(): void {
		if (this.frameHandle !== undefined || this._store.isDisposed) {
			return;
		}
		const win = getWindow(this.container);
		this.frameHandle = win.requestAnimationFrame(now => {
			this.frameHandle = undefined;
			const dt = this.lastFrame ? Math.min(48, now - this.lastFrame) : 16;
			this.lastFrame = now;
			// Reduced motion: no loop; static frames are drawn on state/theme/layout changes.
			if (!this.isMotionReduced()) {
				this.time += dt;
				// Skip the actual painting while the accordion hides the band.
				if (this.container.offsetParent !== null) {
					this.draw(dt);
				}
			}
			this.scheduleFrame();
		});
	}

	private resolveColors(): IStageColors {
		if (!this.colors) {
			const style = getWindow(this.container).getComputedStyle(this.container);
			const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
			this.colors = {
				foreground: token('--vscode-foreground', '#cccccc'),
				accent: token('--vscode-testing-iconPassed', '#73c991'),
			};
		}
		return this.colors;
	}

	private squircle(x: number, y: number, w: number, h: number, r: number): void {
		const ctx = this.ctx!;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	private draw(dt: number): void {
		const ctx = this.ctx;
		if (!ctx || this.width === 0 || this.height === 0) {
			return;
		}
		const motion = !this.isMotionReduced();
		const { foreground, accent } = this.resolveColors();
		const state = this.status.state;
		ctx.clearRect(0, 0, this.width, this.height);

		// The manager sits at the center of everything it runs.
		const cx = this.width * 0.5;
		const cy = this.height * 0.44;
		const bodyW = 68;
		const bodyH = 74;

		if (motion) {
			this.pointerX += (this.pointerTargetX - this.pointerX) * Math.min(1, dt / 180);
			this.pointerY += (this.pointerTargetY - this.pointerY) * Math.min(1, dt / 180);
		}

		// Springs: tilt follows the pointer (leaning slightly while building); rise settles after the completion kick.
		const lean = state === 'building' ? 0.03 : 0;
		const tiltTarget = this.pointerX * 0.10 + lean;
		if (motion) {
			this.tilt += (tiltTarget - this.tilt) * Math.min(1, dt / 260);
			this.riseVy += (0 - this.riseY) * 0.004 * dt - this.riseVy * 0.008 * dt;
			this.riseY += this.riseVy * dt;
		} else {
			this.tilt = lean;
			this.riseY = 0;
		}

		const breath = motion ? Math.sin(this.time / 4200 * Math.PI * 2) : 0;
		const bob = breath * 2 + this.riseY * 60;
		const buildingPulse = state === 'building' && motion ? 0.5 + 0.5 * Math.sin(this.time / 1600 * Math.PI * 2) : 0;
		this.rimPulse += ((state === 'building' ? buildingPulse * 0.18 : 0) - this.rimPulse) * (motion ? Math.min(1, dt / 400) : 1);

		// Faint floor grid converging behind the character — the space is implied, not built.
		ctx.save();
		ctx.strokeStyle = foreground;
		ctx.globalAlpha = 0.028;
		ctx.lineWidth = 1;
		const horizon = cy + 18;
		for (let i = -5; i <= 5; i++) {
			ctx.beginPath();
			ctx.moveTo(cx + i * 22 + this.pointerX * 8, horizon);
			ctx.lineTo(cx + i * 100 + this.pointerX * 20, this.height + 10);
			ctx.stroke();
		}
		for (let j = 0; j < 3; j++) {
			const y = horizon + 12 + j * j * 14;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(this.width, y);
			ctx.stroke();
		}
		ctx.restore();

		const drawDust = (nearPass: boolean) => {
			for (const mote of this.dust) {
				if ((mote.z > 0.62) !== nearPass) {
					continue;
				}
				const driftX = motion ? Math.sin(this.time / 3000 + mote.phase) * mote.drift : 0;
				const px = mote.x + driftX - this.pointerX * 26 * mote.z;
				const py = mote.y + (motion ? Math.cos(this.time / 4300 + mote.phase) * 2 : 0) - this.pointerY * 12 * mote.z;
				ctx.globalAlpha = 0.04 + mote.z * 0.07;
				ctx.fillStyle = foreground;
				ctx.beginPath();
				ctx.arc(px, py, mote.z * 1.1, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		};
		drawDust(false);

		// Edges: tethers from the manager to every system it runs. Faint at
		// rest, accented when active, flowing dashes while that system builds.
		const anchorX = cx;
		const anchorY = cy + bob + bodyH * 0.34;
		for (const entry of this.chips.values()) {
			const { x, y, depth } = entry.point;
			const nodeState = entry.node.state;
			ctx.save();
			ctx.beginPath();
			const controlX = (anchorX + x) / 2;
			const controlY = Math.max(anchorY, y) + 10 + depth * 8;
			ctx.moveTo(anchorX, anchorY);
			ctx.quadraticCurveTo(controlX, controlY, x, y);
			if (nodeState === 'building') {
				ctx.strokeStyle = accent;
				ctx.globalAlpha = 0.45;
				ctx.setLineDash([4, 5]);
				ctx.lineDashOffset = motion ? -(this.time / 40) % 9 : 0;
			} else if (nodeState === 'active') {
				ctx.strokeStyle = accent;
				ctx.globalAlpha = 0.28;
			} else {
				ctx.strokeStyle = foreground;
				ctx.globalAlpha = nodeState === 'attention' ? 0.20 : 0.10;
			}
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.restore();
		}

		// Orbiting shards of work while building; the orbit passes behind and in front of the body.
		interface IShard { x: number; y: number; front: boolean; size: number }
		const shards: IShard[] = [];
		if (state === 'building') {
			for (let i = 0; i < 3; i++) {
				const angle = (motion ? this.time / 2600 : 0.6) * Math.PI * 2 + i * (Math.PI * 2 / 3);
				shards.push({
					x: cx + Math.cos(angle) * 62,
					y: cy + bob * 0.4 + Math.sin(angle) * 19 - 3,
					front: Math.sin(angle) > 0,
					size: 5 + Math.cos(angle + 1) * 1.2,
				});
			}
		}
		const drawShard = (shard: IShard) => {
			ctx.save();
			ctx.translate(shard.x, shard.y);
			this.squircle(-shard.size / 2, -shard.size / 2, shard.size, shard.size, shard.size * 0.38);
			ctx.globalAlpha = 0.35;
			ctx.fillStyle = foreground;
			ctx.fill();
			ctx.globalAlpha = shard.front ? 0.45 : 0.22;
			ctx.strokeStyle = accent;
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.restore();
		};
		shards.filter(shard => !shard.front).forEach(drawShard);

		// Contact shadow anchors the body to the implied floor.
		ctx.save();
		ctx.translate(cx, cy + bodyH / 2 + 13);
		ctx.scale(Math.max(0.6, 1 - (bob + 4) * 0.012), 1);
		const shadow = ctx.createRadialGradient(0, 0, 3, 0, 0, 40);
		shadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
		shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
		ctx.fillStyle = shadow;
		ctx.beginPath();
		ctx.ellipse(0, 0, 40, 8, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		// One completion pulse on the floor plane.
		if (this.ringElapsed >= 0) {
			this.ringElapsed += dt;
			const k = Math.min(1, this.ringElapsed / 900);
			ctx.save();
			ctx.translate(cx, cy + bodyH / 2 + 13);
			ctx.globalAlpha = 0.5 * (1 - k);
			ctx.strokeStyle = accent;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.ellipse(0, 0, 28 + k * 62, (28 + k * 62) * 0.24, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
			if (k >= 1) {
				this.ringElapsed = -1;
			}
		}

		// The body: a glass pebble shaded with the theme's own foreground over its background.
		ctx.save();
		ctx.translate(cx, cy + bob);
		ctx.rotate(this.tilt);
		ctx.scale(1 + breath * 0.008, 1 - breath * 0.012);

		this.squircle(-bodyW / 2, -bodyH / 2, bodyW, bodyH, bodyW * 0.42);
		ctx.save();
		ctx.clip();
		// Base: foreground washed over the panel background (which shows through the canvas).
		const base = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
		base.addColorStop(0, 'rgba(0, 0, 0, 0)');
		base.addColorStop(1, 'rgba(0, 0, 0, 0.30)');
		ctx.globalAlpha = 0.10;
		ctx.fillStyle = foreground;
		ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
		ctx.globalAlpha = 1;
		ctx.fillStyle = base;
		ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
		// Sheen shifts opposite the pointer to sell volume.
		const sheenX = -bodyW * 0.22 - this.pointerX * 8;
		const sheenY = -bodyH * 0.28 - this.pointerY * 6;
		const sheen = ctx.createRadialGradient(sheenX, sheenY, 2, sheenX, sheenY, bodyW * 0.75);
		sheen.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
		sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.fillStyle = sheen;
		ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
		// Rim light: the accent along the upper-right edge, brighter while building/complete.
		const rimAlpha = 0.28 + this.rimPulse + (state === 'complete' ? 0.10 : 0);
		const rim = ctx.createLinearGradient(bodyW / 2, -bodyH / 2, -bodyW / 4, bodyH / 3);
		rim.addColorStop(0, accent);
		rim.addColorStop(1, 'rgba(0, 0, 0, 0)');
		this.squircle(-bodyW / 2, -bodyH / 2, bodyW, bodyH, bodyW * 0.42);
		ctx.globalAlpha = rimAlpha;
		ctx.strokeStyle = rim;
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.restore();

		// Eyes — the entire face. A blink every few seconds; narrowed focus while building.
		if (this.blinkElapsed >= 0) {
			this.blinkElapsed += dt;
		}
		if (motion && this.blinkElapsed < 0 && this.time > this.blinkAt) {
			this.blinkElapsed = 0;
		}
		let eyeScale = 1;
		if (this.blinkElapsed >= 0) {
			const p = this.blinkElapsed / 150;
			eyeScale = p < 1 ? Math.abs(1 - 2 * Math.min(p, 1)) : 1;
			if (p >= 1) {
				this.blinkElapsed = -1;
				this.blinkAt = this.time + 3500 + Math.random() * 5000;
			}
		}
		if (state === 'building') {
			eyeScale *= 0.62;
		}
		const eyeW = 4.5;
		const eyeH = 12 * Math.max(0.06, eyeScale);
		const eyeX = this.pointerX * 5;
		const eyeY = this.pointerY * 4 - 7;
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = foreground;
		for (const side of [-1, 1]) {
			this.squircle(side * 11 + eyeX - eyeW / 2, eyeY - eyeH / 2, eyeW, eyeH, eyeW / 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		ctx.restore();

		shards.filter(shard => shard.front).forEach(drawShard);
		drawDust(true);
	}
}

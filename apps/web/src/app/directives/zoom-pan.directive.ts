import { Directive, ElementRef, inject, signal } from '@angular/core';

const ZOOM_STEP = 1.4;
const MAX_MULT = 6; // max zoom = fit × 6
const PAN_THRESHOLD = 8;

@Directive({ selector: '[bceZoomPan]', exportAs: 'zoomPan' })
export class ZoomPanDirective {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private content: HTMLElement | null = null;

    private fitScale = 1; // the fit-to-viewport baseline (min zoom)
    private scale = 1;
    private tx = 0;
    private ty = 0;

    private pinching = false;
    private pStartDist = 1; private pStartScale = 1; private pStartTx = 0; private pStartTy = 0; private pStartMidX = 0; private pStartMidY = 0;
    private panStart: { x: number; y: number; tx: number; ty: number } | null = null;
    private panning = false;

    private ro: ResizeObserver | null = null;
    private rafPending = false;

    readonly zoomed = signal(false);

    constructor() {
        this.host.style.touchAction = 'none';
        this.host.style.overflow = 'hidden';
        this.host.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: false });
        this.host.addEventListener('touchmove', this.onTouchMove, { capture: true, passive: false });
        this.host.addEventListener('touchend', this.onTouchEnd, { capture: true });
        this.host.addEventListener('touchcancel', this.onTouchEnd, { capture: true });
        const block = (e: PointerEvent): void => { if (this.pinching || this.panning) e.stopImmediatePropagation(); };
        this.host.addEventListener('pointerdown', block, { capture: true });
        this.host.addEventListener('pointermove', block, { capture: true });
        this.host.addEventListener('pointerup', block, { capture: true });
        // re-fit whenever the viewport (orientation) or the content (svg load / unit switch) changes size.
        try {
            this.ro = new ResizeObserver(() => this.scheduleFit());
            this.ro.observe(this.host);
        } catch { /* no ResizeObserver — fit() still runs on gestures/buttons */ }
    }

    private resolveContent(): HTMLElement | null {
        const el = this.host.firstElementChild as HTMLElement | null;
        if (el && el !== this.content) {
            this.content = el;
            el.style.transformOrigin = '0 0';
            el.style.willChange = 'transform';
            try { this.ro?.observe(el); } catch { /* */ }
            this.scheduleFit();
        }
        return el;
    }

    private scheduleFit(): void {
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => { this.rafPending = false; if (this.scale <= this.fitScale * 1.02) this.fit(); });
    }

    /** Scale the whole sheet to fit the viewport (both dimensions) and centre it. The zoomed-out baseline. */
    fit(): void {
        const c = this.resolveContent();
        if (!c) return;
        const rect = this.host.getBoundingClientRect();
        const cw = c.offsetWidth, ch = c.offsetHeight; // natural (untransformed) layout size
        if (!rect.width || !rect.height || !cw || !ch) return;
        this.fitScale = Math.min(rect.width / cw, rect.height / ch, 1);
        this.scale = this.fitScale;
        this.tx = (rect.width - cw * this.scale) / 2;
        this.ty = (rect.height - ch * this.scale) / 2;
        this.commit(c, rect);
    }

    // ── touch gestures ──
    private onTouchStart = (e: TouchEvent): void => {
        if (e.touches.length === 2) {
            this.pinching = true; this.panning = false; this.panStart = null;
            e.preventDefault(); this.cancelSvgPick();
            const [a, b] = [e.touches[0], e.touches[1]];
            this.pStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
            this.pStartScale = this.scale; this.pStartTx = this.tx; this.pStartTy = this.ty;
            this.pStartMidX = (a.clientX + b.clientX) / 2; this.pStartMidY = (a.clientY + b.clientY) / 2;
        } else if (e.touches.length === 1 && this.scale > this.fitScale * 1.02) {
            const t = e.touches[0];
            this.panStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
            this.panning = false;
        }
    };

    private onTouchMove = (e: TouchEvent): void => {
        if (this.pinching && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
            const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2;
            const s = this.clampScale(this.pStartScale * (dist / this.pStartDist));
            const rect = this.host.getBoundingClientRect();
            const aX = this.pStartMidX - rect.left, aY = this.pStartMidY - rect.top;
            const cX = (aX - this.pStartTx) / this.pStartScale, cY = (aY - this.pStartTy) / this.pStartScale;
            this.tx = (midX - rect.left) - cX * s; this.ty = (midY - rect.top) - cY * s; this.scale = s;
            this.commit();
        } else if (this.panStart && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - this.panStart.x, dy = t.clientY - this.panStart.y;
            if (!this.panning && Math.hypot(dx, dy) > PAN_THRESHOLD) { this.panning = true; this.cancelSvgPick(); }
            if (this.panning) { e.preventDefault(); this.tx = this.panStart.tx + dx; this.ty = this.panStart.ty + dy; this.commit(); }
        }
    };

    private onTouchEnd = (e: TouchEvent): void => {
        if (e.touches.length < 2) this.pinching = false;
        if (e.touches.length === 0) { this.panStart = null; this.panning = false; }
    };

    private cancelSvgPick(): void {
        try { this.host.querySelector('svg')?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })); } catch { /* */ }
    }

    // ── buttons (centre-anchored) ──
    zoomIn(): void { this.zoomBy(ZOOM_STEP); }
    zoomOut(): void { this.zoomBy(1 / ZOOM_STEP); }
    reset(): void { this.fit(); }
    private zoomBy(factor: number): void {
        const rect = this.host.getBoundingClientRect();
        const cx = rect.width / 2, cy = rect.height / 2;
        const next = this.clampScale(this.scale * factor);
        const contentX = (cx - this.tx) / this.scale, contentY = (cy - this.ty) / this.scale;
        this.tx = cx - contentX * next; this.ty = cy - contentY * next; this.scale = next;
        this.commit();
    }

    private clampScale(s: number): number { return Math.max(this.fitScale, Math.min(this.fitScale * MAX_MULT, s)); }

    private commit(c?: HTMLElement | null, rect?: DOMRect): void {
        const el = c ?? this.resolveContent();
        if (!el) return;
        const r = rect ?? this.host.getBoundingClientRect();
        const cw = el.offsetWidth * this.scale, ch = el.offsetHeight * this.scale;
        this.tx = cw <= r.width ? (r.width - cw) / 2 : Math.max(r.width - cw, Math.min(0, this.tx));
        this.ty = ch <= r.height ? (r.height - ch) / 2 : Math.max(r.height - ch, Math.min(0, this.ty));
        el.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
        this.zoomed.set(this.scale > this.fitScale * 1.02);
    }
}

import { Component, ChangeDetectionStrategy, inject, signal, effect, untracked, output } from '@angular/core';
import { WarchestService, type SpTx } from '../chaos/warchest.service';

interface SpToast { id: number; message: string; income: boolean; settlement: boolean; note: boolean; action: 'ledger' | 'repair'; }
const DURATION_MS = 4200;
const MAX = 3;

@Component({
    selector: 'bce-sp-toast',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="spt-wrap" aria-live="polite" aria-atomic="false">
            @for (t of toasts(); track t.id) {
                <div class="spt" [class.income]="t.income" [class.settle]="t.settlement" [class.note]="t.note" [attr.data-action]="t.action" role="status" data-testid="spt-toast">
                    <span class="spt-msg">{{ t.message }}</span>
                    @if (t.action === 'repair') {
                        <button type="button" class="spt-link" (click)="viewRepair.emit()" data-testid="spt-view-repair">Repair &#9656;</button>
                    } @else {
                        <button type="button" class="spt-link" (click)="viewLedger.emit()" data-testid="spt-view-ledger">View ledger &#9656;</button>
                    }
                    <button type="button" class="spt-x" (click)="dismiss(t.id)" aria-label="Dismiss">&#10005;</button>
                </div>
            }
        </div>
    `,
    styles: [`
        /* bottom-center, above the phone safe-area; fixed + pointer-events only on the pills, so it never
           gates or covers the action UI (the tab panels scroll underneath). z below modal overlays (50). */
        .spt-wrap { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(14px + var(--bce-footer-h, 0px));z-index:44; display:flex; flex-direction:column; gap:8px; align-items:center; width:max-content; max-width:min(92vw, 460px); pointer-events:none; }
        .spt { pointer-events:auto; display:flex; align-items:center; gap:12px; background:var(--paper2, var(--paper, #f4ecd8)); color:var(--ink, #1a1407); border:1.6px solid var(--ink, #1a1407); border-left:4px solid var(--stamp, #7a2d1e); box-shadow:0 6px 20px rgba(0,0,0,.35); padding:9px 12px; font-family:var(--type); font-size:13px; animation:spt-in .18s ease-out; }
        .spt.income { border-left-color:var(--ok, #3a7d44); }
        .spt.settle { border-left-color:var(--ink2, #6b5d43); }
        .spt.note { border-left-color:var(--ink, #1a1407); } /* PD3 P1 — a note (no SP moved) */
        .spt-msg { font-weight:600; }
        .spt-link { flex:0 0 auto; font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:11px; text-transform:uppercase; border:1.3px solid var(--stamp, #7a2d1e); background:transparent; color:var(--stamp, #7a2d1e); padding:5px 9px; cursor:pointer; min-height:32px; }
        .spt-link:hover, .spt-link:focus-visible { background:var(--stamp, #7a2d1e); color:var(--paper, #f4ecd8); outline:none; }
        .spt-x { flex:0 0 auto; border:none; background:transparent; color:var(--ink2, #6b5d43); font-size:14px; line-height:1; cursor:pointer; padding:4px; }
        @keyframes spt-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @media (max-width:560px) { .spt { flex-wrap:wrap; font-size:12.5px; } .spt-msg { flex:1 1 100%; } }
    `],
})
export class SpToastComponent {
    private readonly warchest = inject(WarchestService);
    readonly viewLedger = output<void>();
    readonly viewRepair = output<void>();

    protected readonly toasts = signal<SpToast[]>([]);
    private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
    private lastSeen = 0;

    constructor() {
        // Read the funnel's announcement signal; enqueue one toast per player-initiated (or coalesced) transaction.
        effect(() => {
            const tx = this.warchest.transaction();
            untracked(() => { if (tx && tx.id !== this.lastSeen) { this.lastSeen = tx.id; this.enqueue(tx); } });
        });
    }

    private enqueue(tx: SpTx): void {
        if (tx.note) { // PD3 P1 — a plain note: the event text verbatim, no SP suffix
            this.toasts.update((list) => {
                const next = [...list, { id: tx.id, message: tx.event, income: false, settlement: false, note: true, action: tx.action ?? 'ledger' }];
                while (next.length > MAX) { const dropped = next.shift(); if (dropped) this.clear(dropped.id); }
                return next;
            });
            this.timers.set(tx.id, setTimeout(() => this.dismiss(tx.id), DURATION_MS * 2)); // a witness line reads longer than a spend
            return;
        }
        const income = tx.paid < 0;
        const amount = Math.abs(tx.paid).toLocaleString('en-US');
        const bal = tx.balance.toLocaleString('en-US');
        const sign = tx.settlement ? (income ? '+' : '−') : income ? '+' : '−';
        const message = tx.settlement
            ? `${tx.event} · net ${sign}${amount} SP (balance ${bal} SP)`
            : `${tx.event} · ${sign}${amount} SP (balance ${bal} SP)`;
        this.toasts.update((list) => {
            const next = [...list, { id: tx.id, message, income, settlement: !!tx.settlement, note: false, action: 'ledger' as const }];
            while (next.length > MAX) { const dropped = next.shift(); if (dropped) this.clear(dropped.id); }
            return next;
        });
        this.timers.set(tx.id, setTimeout(() => this.dismiss(tx.id), DURATION_MS));
    }
    protected dismiss(id: number): void {
        this.clear(id);
        this.toasts.update((list) => list.filter((t) => t.id !== id));
    }
    private clear(id: number): void { const h = this.timers.get(id); if (h) { clearTimeout(h); this.timers.delete(id); } }
}

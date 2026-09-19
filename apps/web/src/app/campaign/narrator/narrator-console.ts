import { Component, ChangeDetectionStrategy, OnDestroy, computed, inject, signal } from '@angular/core';
import { NarratorService } from './narrator.service';
import type { NarratorStats } from './narrator-types';

@Component({
    selector: 'bce-narrator-console',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './narrator-console.html',
    styleUrl: './narrator-console.scss',
})
export class NarratorConsoleComponent implements OnDestroy {
    private readonly narrator = inject(NarratorService);
    protected readonly mode = this.narrator.mode;
    protected readonly cumulative = this.narrator.cumulative;
    protected readonly stats = signal<NarratorStats | null>(null);
    private poll: ReturnType<typeof setInterval> | null = null;
    private beat: ReturnType<typeof setInterval> | null = null;

    /** Live llama state for the status dot (off | loading | ready | offline-when-sidecar-down). */
    protected readonly llamaState = computed(() => {
        const s = this.stats();
        if (this.mode() !== 'local') return 'off';
        if (!s || s.sidecar === 'offline') return 'sidecar-off';
        return s.llama.status;
    });

    constructor() {
        // Poll stats (~3s) + heartbeat (~20s) only while focused + mode local. visibilitychange gates it.
        const tick = async () => {
            if (this.mode() !== 'local') { this.stats.set(null); return; }
            const focused = typeof document === 'undefined' || document.visibilityState === 'visible';
            this.narrator.heartbeat(focused);
            if (focused) this.stats.set(await this.narrator.stats());
        };
        this.poll = setInterval(tick, 3000);
        this.beat = setInterval(() => { if (this.mode() === 'local') this.narrator.heartbeat(typeof document === 'undefined' || document.visibilityState === 'visible'); }, 20000);
        void tick();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', tick);
    }

    ngOnDestroy(): void {
        if (this.poll) clearInterval(this.poll);
        if (this.beat) clearInterval(this.beat);
    }

    protected fmtK(n: number): string { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
}

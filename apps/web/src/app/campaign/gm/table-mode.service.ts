import { Injectable, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';

const KEY = 'bce.gm.tablemode';

@Injectable({ providedIn: 'root' })
export class TableModeService {
    private readonly state = inject(NewCampaignState);
    private readonly onSig = signal<boolean>((() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })());

    /** Live only inside a GM session — everywhere else this is constant false. */
    readonly on = computed(() => this.onSig() && this.state.gmSession());
    /** The raw device toggle (for the GM-panel switch itself, which renders only in a gmSession anyway). */
    readonly raw = this.onSig.asReadonly();

    toggle(): void {
        const v = !this.onSig();
        this.onSig.set(v);
        try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode / no storage — session-only toggle */ }
    }
}

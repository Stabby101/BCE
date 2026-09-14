/*
 * GM-1 P1 — TABLE MODE: presentation discipline for the projected/shared GM screen. In hosted reality the
 * campaign is ALREADY owner-locked server-side (HARDEN-5); what table mode ADDS is that the GM can project
 * the dashboard without leaking GM-only surfaces (offer board, OpFor builder, resolve) to the room.
 * DEVICE-LOCAL by design (localStorage, never the snapshot): it describes THIS screen, not the campaign —
 * the GM's laptop can be in table mode while their tablet is not. The `on` computed hard-gates on
 * gmSession so a plain HS/Traditional campaign can never blank anything (byte-identical behavior).
 */
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

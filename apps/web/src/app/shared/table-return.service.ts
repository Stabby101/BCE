/*
 * GM-3 P3 — the "◄ Back to the table" context. When the ROOT app is opened via the hand-off
 * (`/?campaign=<homeId>&engine=<engine>&returnTo=/player/?campaign=<sessionId>&engine=…`), the cover validates the
 * returnTo (client safeTablePath gate) and stashes it here; the dashboard header renders the control and navigates back to
 * the join link (campaign + engine intact) same-tab. Session-scoped, cleared once consumed by a navigation home.
 */
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TableReturnService {
    /** The validated same-origin `/player/…` join path to return to, or null when the root app was not opened from a table. */
    readonly returnTo = signal<string | null>(null);
    set(path: string | null): void { this.returnTo.set(path); }
    /** Navigate back to the table (same tab). No-op when there is nothing to return to. */
    back(): void { const p = this.returnTo(); if (p) location.assign(`${location.origin}${p}`); }
}

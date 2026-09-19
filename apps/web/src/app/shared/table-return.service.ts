import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TableReturnService {
    /** The validated same-origin `/player/…` join path to return to, or null when the root app was not opened from a table. */
    readonly returnTo = signal<string | null>(null);
    set(path: string | null): void { this.returnTo.set(path); }
    /** Navigate back to the table (same tab). No-op when there is nothing to return to. */
    back(): void { const p = this.returnTo(); if (p) location.assign(`${location.origin}${p}`); }
}

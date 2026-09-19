import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SheetRevService {
    private readonly _rev = signal<Record<string, number>>({});
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

    /** The card's revision — read this in a cell binding to depend ONLY on that one card's dirty bit. */
    rev(instanceId: string): number {
        return this._rev()[instanceId] ?? 0;
    }

    /** Flip one card's dirty bit (coalesced — repeated bumps within ~40 ms = one re-read of that card). */
    bump(instanceId: string): void {
        if (!instanceId || this.pending.has(instanceId)) return; // already scheduled → coalesce the burst
        this.pending.set(
            instanceId,
            setTimeout(() => {
                this.pending.delete(instanceId);
                this._rev.update((m) => ({ ...m, [instanceId]: (m[instanceId] ?? 0) + 1 }));
            }, 40),
        );
    }
}

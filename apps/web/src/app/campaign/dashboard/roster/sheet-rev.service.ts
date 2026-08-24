/*
 * BCE — DIRECTIVE-084: per-card dirty bits.
 *
 * A damage / crew / condition DIFF to ONE unit's sheet flips ONLY that card's revision; a roster cell
 * derives its DMG line + thumbnail off `rev(its instanceId)`, so a flip pulls just that card's current
 * state once — sibling cells never recompute. There is NO polling anywhere: the flip IS the trigger,
 * repeating on each diff through the unit's life (replaces the coarse whole-roster `crewRev` nudge).
 *
 * Bumps are COALESCED per id: a burst of diffs for the same card within ~40 ms collapses to ONE re-read
 * (and the defer doubles as the proven D-020 tick — it lets the live SVG paint settle before the thumbnail
 * re-clones). Card-type-agnostic: keyed by instanceId, independent of CBT vs Alpha-Strike rendering.
 */
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

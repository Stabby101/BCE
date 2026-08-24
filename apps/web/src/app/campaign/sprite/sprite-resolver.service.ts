/*
 * BCE — THE sprite lookup path (HOTFIX-003). ONE resolver: the roster, the market BUY list, and the
 * mission OpFor read-out all flow through it (it is the only sprite-normalization layer in apps/web).
 * Given a unit-ish subject it returns either an EXACT manifest key (exact / case-punct-normalized /
 * nearest-silhouette family) or null → render a weight-class silhouette. MekBay's SpriteStorageService
 * and unit-icon are read-only (FORK-001): we consume getManifest() and hand unit-icon a resolved-key
 * clone; the question mark (unknown.png) never reaches a unit we generated.
 */
import { Injectable, inject, signal } from '@angular/core';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { SPRITE_ALIASES, normSprite, normWeightClass, type WeightClass } from './sprite-aliases';

/** The minimum a caller must supply — a full Unit satisfies this structurally. */
export interface SpriteSubject {
    icon?: string;
    chassis?: string;
    model?: string;
    weightClass?: string;
    tons?: number;
}

export interface SpriteResolution {
    /** an EXACT manifest key (render via unit-icon), or null → weight-class silhouette */
    iconKey: string | null;
    wc: WeightClass;
    /** how it matched — for the probe/report + debugging */
    via: 'exact' | 'alias' | 'normalized' | 'family' | 'silhouette' | 'pending';
}

@Injectable({ providedIn: 'root' })
export class SpriteResolverService {
    private readonly sprites = inject(SpriteStorageService);

    private readonly exact = new Set<string>();
    private readonly normIndex = new Map<string, string>();     // normSprite(path)    → key
    private readonly chassisIndex = new Map<string, string>();  // normSprite(chassis) → base|any meks key

    /** Flips true once the manifest is indexed; components read it so they re-resolve on arrival. */
    private readonly _ready = signal(false);
    readonly ready = this._ready.asReadonly();

    constructor() {
        void this.build();
    }

    private async build(): Promise<void> {
        const manifest = await this.sprites.getManifest();
        if (!manifest) return; // offline / fetch fail — stays unready, subjects render optimistic exact
        const base = new Map<string, string>();
        for (const key of Object.keys(manifest.icons)) {
            this.exact.add(key);
            const n = normSprite(key);
            if (!this.normIndex.has(n)) this.normIndex.set(n, key);
            if (manifest.icons[key].type !== 'meks') continue;
            const stem = key.replace(/^meks\//, '').replace(/\.png$/i, '');
            const nc = normSprite(stem.split('_')[0]);
            if (!this.chassisIndex.has(nc)) this.chassisIndex.set(nc, key);
            if (!stem.includes('_')) base.set(nc, key); // prefer the plain-chassis art as the family alias
        }
        for (const [nc, key] of base) this.chassisIndex.set(nc, key);
        this._ready.set(true);
    }

    /** THE lookup. Cheap + synchronous once ready(). Order: exact → alias → normalized → family → silhouette. */
    resolve(subject: SpriteSubject): SpriteResolution {
        const wc = normWeightClass(subject.weightClass, subject.tons);
        const icon = subject.icon || '';
        if (!this._ready()) {
            // pre-manifest: optimistic exact so a hot cache paints immediately; re-resolves once ready().
            return { iconKey: icon || null, wc, via: 'pending' };
        }
        if (icon && this.exact.has(icon)) return { iconKey: icon, wc, via: 'exact' };
        const aliasKey = SPRITE_ALIASES[normSprite(icon)] ?? SPRITE_ALIASES[normSprite(subject.chassis)];
        if (aliasKey && this.exact.has(aliasKey)) return { iconKey: aliasKey, wc, via: 'alias' };
        const normHit = this.normIndex.get(normSprite(icon));
        if (normHit) return { iconKey: normHit, wc, via: 'normalized' };
        const famHit = this.chassisIndex.get(normSprite(subject.chassis));
        if (famHit) return { iconKey: famHit, wc, via: 'family' };
        return { iconKey: null, wc, via: 'silhouette' };
    }
}

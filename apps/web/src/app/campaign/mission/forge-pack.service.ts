import { Injectable, inject } from '@angular/core';
import type { MissionSeed, ForgeNpc, ForgeVoice } from './forge-types';
import { NewCampaignState } from '../new-campaign-state';
import { synthSeedFromPreset } from '../chaos/chaos-track-preset';
import { synthSeedFromTemplate, type TrackTemplateKey } from '../chaos/track-setup';
import { HotSpotsCatalogService } from '../chaos/hotspots-catalog';

@Injectable({ providedIn: 'root' })
export class ForgePackService {
    private readonly state = inject(NewCampaignState);
    private readonly hotspots = inject(HotSpotsCatalogService);
    private seedsCache: MissionSeed[] | null = null;
    private npcsCache: ForgeNpc[] | null = null;
    private voicesCache: ForgeVoice[] | null = null;
    private loading: Promise<void> | null = null;

    /** Load the pack once (idempotent). Call before selection/render. */
    ensureLoaded(): Promise<void> {
        if (this.seedsCache) return Promise.resolve();
        if (!this.loading) this.loading = this.load();
        return this.loading;
    }
    isLoaded(): boolean {
        return this.seedsCache !== null;
    }

    private async load(): Promise<void> {
        try {
            const [clan, era, def, irr, raid, clanDeep, darkAge, jihad, mercDeep, periphery, arcTree, inspW1, inspArcFortress, inspW2, ilClan, starLeague, civilWar, darkAge2, darkAge3, npc, voice] = await Promise.all([
                import('./forge-data/seeds-clan-invasion.json'),
                import('./forge-data/seeds-era-spread.json'),
                import('./forge-data/seeds-sw-defense.json'),
                import('./forge-data/seeds-sw-irregular.json'),
                import('./forge-data/seeds-sw-raids.json'),
                import('./forge-data/seeds-clan-deep.json'),
                import('./forge-data/seeds-dark-age.json'),
                import('./forge-data/seeds-jihad.json'),
                import('./forge-data/seeds-merc-deep.json'),
                import('./forge-data/seeds-periphery-comstar.json'),
                import('./forge-data/seeds-arc-tree.json'),
                import('./forge-data/seeds-insp-wave1.json'),
                import('./forge-data/seeds-insp-arc-fortress.json'),
                import('./forge-data/seeds-insp-wave2.json'),
                import('./forge-data/seeds-ilclan.json'),
                import('./forge-data/seeds-star-league.json'),
                import('./forge-data/seeds-civil-war.json'),
                import('./forge-data/seeds-dark-age-2.json'),
                import('./forge-data/seeds-dark-age-3.json'),
                import('./forge-data/npc-marquee.json'),
                import('./forge-data/voice-cast.json'),
            ]);
            const arr = (m: { default: unknown }): unknown[] => (Array.isArray(m.default) ? (m.default as unknown[]) : []);
            this.seedsCache = [
                ...arr(clan), ...arr(era), ...arr(def), ...arr(irr), ...arr(raid),
                ...arr(clanDeep), ...arr(darkAge), ...arr(jihad), ...arr(mercDeep), ...arr(periphery), ...arr(arcTree),
                ...arr(inspW1), ...arr(inspArcFortress), ...arr(inspW2),
                ...arr(ilClan), ...arr(starLeague), ...arr(civilWar),
                ...arr(darkAge2), ...arr(darkAge3),
            ] as MissionSeed[];
            this.npcsCache = arr(npc) as ForgeNpc[];
            this.voicesCache = arr(voice) as ForgeVoice[];
        } catch {
            this.seedsCache = [];
            this.npcsCache = [];
            this.voicesCache = [];
        }
    }

    seeds(): MissionSeed[] {
        return this.seedsCache ?? [];
    }
    npcs(): ForgeNpc[] {
        return this.npcsCache ?? [];
    }
    voices(): ForgeVoice[] {
        return this.voicesCache ?? [];
    }
    seedById(id: string | undefined): MissionSeed | undefined {
        if (!id) return undefined;
        // random selector never picks it); resolve it back to the live preset so the render/resolve/AAR see its content.
        if (id.startsWith('preset-')) {
            if (id.startsWith('preset-tpl-')) return synthSeedFromTemplate(id.slice('preset-tpl-'.length) as TrackTemplateKey);
            const p = (this.state.chaosTrackPresets() ?? []).find((x) => 'preset-' + x.id === id);
            if (p) return synthSeedFromPreset(p);
            // (with its authored forks) so forkChildren + the arc-link selection branch the authored tree.
            return this.hotspots.seedForSeedId(id);
        }
        return this.seeds().find((s) => s.seedId === id);
    }
    npcById(id: string | undefined): ForgeNpc | undefined {
        return id ? this.npcs().find((n) => n.npcId === id) : undefined;
    }
    voiceById(id: string | undefined): ForgeVoice | undefined {
        return id ? this.voices().find((v) => v.voiceId === id) : undefined;
    }
}

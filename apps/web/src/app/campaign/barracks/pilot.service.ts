import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { generatePilots, type Pilot } from './pilot-generator';
import { generateBio } from './pilot-bio';
import { campaignRegister, eraTag } from '../mission/forge-select';
import type { ProtoInstance } from '../force/force-generator';

@Injectable({ providedIn: 'root' })
export class PilotService {
    private readonly state = inject(NewCampaignState);

    private today(): { y: number; m: number; d: number } {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
    }
    private bioFor(): string {
        const register = campaignRegister(this.state.force(), this.state.faction());
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? 3025;
        return generateBio(register, eraTag(year));
    }
    private dress(p: Pilot): Pilot {
        return { ...p, bio: this.bioFor(), recordsBegin: this.today(), missionCount: 0 };
    }

    /** Generate pilots for the current campaign's force (1:1 + spares) and store them. */
    generateForCampaign(): void {
        const force = this.state.startingForce();
        if (!force || !force.length) {
            this.state.setPilots(force ? [] : null); // empty force (build-own) -> no pilots
            return;
        }
        this.state.setPilots(generatePilots(force, this.state.rating()).map((p) => this.dress(p)));
    }

    ensurePilots(): boolean {
        const force = this.state.startingForce();
        if (!force || !force.length) return false;
        if (this.state.pilots() !== null) return false; // already have pilots (possibly [])
        this.state.setPilots(generatePilots(force, this.state.rating()).map((p) => this.dress(p)));
        return true;
    }

    ensureBios(): boolean {
        const pilots = this.state.pilots();
        if (!pilots?.length || pilots.every((p) => !!p.bio)) return false;
        this.state.setPilots(pilots.map((p) => (p.bio ? p : { ...p, bio: this.bioFor(), recordsBegin: p.recordsBegin ?? this.today() })));
        return true;
    }

    /** The pilot crewing an instance, or undefined (unassigned 'Mech). */
    pilotFor(instanceId: string): Pilot | undefined {
        return (this.state.pilots() ?? []).find((p) => p.assignedInstanceId === instanceId);
    }

    mintRecruit(): void {
        const existing = this.state.pilots() ?? [];
        const seed: ProtoInstance = { instanceId: `seed-${Math.floor(Math.random() * 1e9)}`, unitRef: '', chassis: '', model: '', mulId: 0, tons: 50, bv: 1000, condition: 'Active' };
        const base = generatePilots([seed], this.state.rating())[0];
        if (!base) return;
        const recruit: Pilot = this.dress({ ...base, pilotId: `pilot-rec-${Math.floor(Math.random() * 1e9)}`, assignedInstanceId: undefined });
        this.state.setPilots([...existing, recruit]);
    }

    assign(pilotId: string, instanceId: string | null): void {
        const pilots = this.state.pilots() ?? [];
        const target = pilots.find((p) => p.pilotId === pilotId);
        if (target?.status === 'KIA') return; // dead stays dead — no control resurrects
        const next = pilots.map((p) => {
            if (instanceId && p.assignedInstanceId === instanceId && p.pilotId !== pilotId) {
                return { ...p, assignedInstanceId: undefined }; // bump the prior crew to spares
            }
            if (p.pilotId === pilotId) {
                return { ...p, assignedInstanceId: instanceId ?? undefined };
            }
            return p;
        });
        this.state.setPilots(next);
    }

    //    the service re-guards the hard lines). Callers persist. ──
    grantPerk(pilotId: string, abilityId: string): void {
        this.state.setPilots((this.state.pilots() ?? []).map((p) => {
            if (p.pilotId !== pilotId || p.status === 'KIA') return p;
            const held = p.perks ?? [];
            return held.includes(abilityId) ? p : { ...p, perks: [...held, abilityId] };
        }));
    }
    revokePerk(pilotId: string, abilityId: string): void {
        this.state.setPilots((this.state.pilots() ?? []).map((p) =>
            p.pilotId === pilotId ? { ...p, perks: (p.perks ?? []).filter((id) => id !== abilityId) } : p));
    }
    setBio(pilotId: string, bio: string): void {
        this.state.setPilots((this.state.pilots() ?? []).map((p) => (p.pilotId === pilotId ? { ...p, bio } : p)));
    }
    rename(pilotId: string, name: string): void {
        const n = name.trim();
        if (!n) return;
        this.state.setPilots((this.state.pilots() ?? []).map((p) => (p.pilotId === pilotId && p.status !== 'KIA' ? { ...p, name: n } : p)));
    }
    setSkills(pilotId: string, gunnery: number, piloting: number): void {
        const g = Math.max(0, Math.min(8, Math.round(gunnery)));
        const pi = Math.max(0, Math.min(9, Math.round(piloting)));
        this.state.setPilots((this.state.pilots() ?? []).map((p) => (p.pilotId === pilotId && p.status !== 'KIA' ? { ...p, gunnery: g, piloting: pi } : p)));
    }
    setGmNotes(pilotId: string, gmNotes: string): void {
        this.state.setPilots((this.state.pilots() ?? []).map((p) => (p.pilotId === pilotId ? { ...p, gmNotes } : p)));
    }
}

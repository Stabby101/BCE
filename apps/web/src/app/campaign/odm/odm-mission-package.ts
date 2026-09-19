import { Component, ChangeDetectionStrategy, computed, HostListener, inject, output, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { ForgePackService } from '../mission/forge-pack.service';
import { DataService } from '../../services/data.service';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
import { MISSION_TYPES } from '../contract/contract-terms';
import {
    costParts, fillSlots, fillSlotsDeep, gateFor, gateMet, registerClassbar, registerClosing, registerStamp, registerVariant,
    type SlotContext,
} from '../mission/forge-select';
import type { ForgeNpc, MissionSeed } from '../mission/forge-types';
import { SUPPORT_TUNABLES } from '../mission/theater';
import { CampaignSaveStore } from '../campaign-save-store';
import { NarratorService } from '../narrator/narrator.service';
import type { RefineTarget, VoiceBoxTarget } from '../narrator/narrator-types';
import type { MissionSpec } from '../mission/mission-spec';
import { diffAfter, type DiffToken } from '../narrator/prose-diff';
import { OdmContactsService, type OdmAarSlot } from './odm-contacts.service';

interface VoiceBox { header: string; lines: string[]; rules: string; refined: boolean; characterization: boolean; }
interface KernelBox { header: string; subject: string; line: string; rules: string; }

interface OptionVm {
    title: string;
    advantages: string[];
    disadvantages: string[];
    consequence: string;
    costLine: string | null;
    treasuryAfter: string | null;
    locked: boolean;
    gateNote: string | null;
    repriceText: string | null;
}

@Component({
    selector: 'bce-odm-mission-package',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent],
    templateUrl: './odm-mission-package.html',
    styleUrl: '../mission/mission-package.scss', // SHARED
})
export class OdmMissionPackageComponent {
    readonly close = output<void>();
    private readonly state = inject(NewCampaignState);
    private readonly pack = inject(ForgePackService);
    private readonly contacts = inject(OdmContactsService);
    private readonly data = inject(DataService);
    protected readonly narrator = inject(NarratorService);
    private readonly store = inject(CampaignSaveStore);

    /** Bumped when the pack finishes loading — the vm depends on it so a reload-opened package paints
     *  once the lazy pack chunks arrive (generation pre-loads them; a fresh session re-loads here). */
    private readonly ready = signal(this.pack.isLoaded() ? 1 : 0);
    constructor() {
        if (!this.pack.isLoaded()) void this.pack.ensureLoaded().then(() => this.ready.update((v) => v + 1));
    }

    private readonly seed = computed<MissionSeed | undefined>(() => {
        this.ready();
        return this.pack.seedById(this.state.missionSpec()?.forge?.seedId);
    });

    private readonly ctx = computed<SlotContext>(() => {
        const f = this.state.missionSpec()?.forge;
        const npcNames: Record<string, string> = {};
        const assigns = this.state.npcAssignments();
        for (const flag of f?.npcFlags ?? []) {
            const npc = this.pack.npcById(assigns[flag]);
            if (npc) npcNames[flag] = npc.name;
        }
        // when no seed prose references the flag, so {NPC:opfor-commander}/{NPC:intel-source} fill (no extra voice box —
        // voice boxes are driven by npcFlags, untouched here).
        for (const flag of ['opfor-commander', 'intel-source']) {
            if (!npcNames[flag] && assigns[flag]) { const npc = this.pack.npcById(assigns[flag]); if (npc) npcNames[flag] = npc.name; }
        }
        return {
            EMPLOYER: f?.slots.EMPLOYER ?? '—',
            TARGET_FACTION: f?.slots.TARGET_FACTION ?? '—',
            WORLD: f?.slots.WORLD ?? '—',
            DISTRICT: f?.slots.DISTRICT ?? '—',
            YEAR: f?.slots.YEAR ?? '—',
            FORCE_SIZE: f?.slots.FORCE_SIZE ?? '—',
            PRIOR_TIER: f?.slots.PRIOR_TIER,
            PRIOR_WORLD: f?.slots.PRIOR_WORLD,
            specifics: f?.rolledSpecifics ?? {},
            npcNames,
        };
    });

    /** The seed's active register for variant lookup — a merc player reads the brief through the merc lens. */
    private readonly variantRegister = computed(() => (this.state.force() === 'MERC' ? 'merc' : this.seed()?.register ?? ''));

    private fill(s: string | number | undefined | null): string {
        // String-coerce defensively: authored pack data occasionally carries numbers/objects where the
        // brief spec'd strings (the era-spread protocol case) — the renderer never dies on data.
        const t = s == null ? '' : String(s);
        return t ? fillSlots(t, this.ctx()) : '';
    }
    private fillDeep<T>(value: T): T {
        return fillSlotsDeep(value, this.ctx());
    }
    /** A v1.3 phase protocol normalized to display lines — string prose OR a kv object both render. */
    private protocolLines(p: string | Record<string, string>): string[] {
        if (typeof p === 'string') return [this.fill(p)];
        return Object.entries(p).map(([k, v]) => `${this.fill(k)}: ${this.fill(v)}`);
    }
    /** A field with a register-variant override applied (then slot-filled). */
    private field(path: string, base: string): string {
        const s = this.seed();
        const v = s ? registerVariant(s, this.variantRegister(), path) : undefined;
        return this.fill(v ?? base);
    }
    private fmt(n: number): string {
        return n.toLocaleString('en-US');
    }

    protected readonly hasSeed = computed(() => !!this.seed());
    protected readonly register = computed(() => this.seed()?.register ?? '');

    protected readonly vm = computed(() => {
        const s = this.seed();
        const spec = this.state.missionSpec();
        if (!s || !spec) return null;
        const c = this.ctx();
        const mt = MISSION_TYPES[s.family as keyof typeof MISSION_TYPES];
        const commandName = this.state.commandName() ?? this.state.unit() ?? 'YOUR COMMAND';

        return {
            classbar: registerClassbar(s.register),
            stamp: registerStamp(s.register),
            unit: `${(this.state.unitSize()?.name ?? 'COMPANY').toUpperCase()} · ${commandName.toUpperCase()}`,
            opname: s.title.replace(/^OPERATION\s+/i, ''),
            oploc: `${c.WORLD} · ${c.DISTRICT}`.toUpperCase(),
            threat: `THREAT RATING — ${(spec.opforBv >= spec.playerBv ? 'HIGH' : (s.threatRange[0] ?? 'MEDIUM'))}`,
            cycle: `${mt?.name ?? s.family} · ${c.YEAR}`,
            source: `Generated mission package`,
            transmission: {
                from: `${c.EMPLOYER} command authority`,
                to: `${commandName} — eyes only`,
                re: `${s.title} — ${mt?.name ?? s.family}, ${c.WORLD}`,
            },
            warnord: [
                ['Operation: ' + s.title.replace(/^OPERATION\s+/i, ''), 'Classification: Unit Eyes Only'],
                [`Mission Type: ${mt?.name ?? s.family}`, this.fill(this.vmThreatRow())],
                [`Assigned Force: ${c.FORCE_SIZE}`, `Command: ${commandName}${this.state.unitSize()?.name ? ' — ' + this.state.unitSize()!.name : ''}, SLDF`],
                [`Target / Opposition: ${c.TARGET_FACTION}`, `Window: ${spec.window.deployByDays}-day deploy · ~${spec.window.engagementDays}-day engagement`],
            ] as [string, string][],
            intent: this.field('objectives.primary', s.objectives.primary),
            situation: this.situationParas(s, spec),
            situationRefined: !!spec.refined?.['situation']?.verified,
            npcVoices: (spec.forge?.npcFlags ?? []).map((flag) => {
                const npc = this.pack.npcById(this.state.npcAssignments()[flag]);
                if (!npc) return null;
                return { header: `${npc.name.toUpperCase()} — ${flag.replace(/-/g, ' ').toUpperCase()}:`, body: npc.background, tags: npc.voiceTags.join(' · ') };
            }).filter((x): x is { header: string; body: string; tags: string } => !!x),
            complications: [...(s.complications ?? []), ...(spec.forge?.rolledComplications ?? [])].map((x) => { const xf = this.fillDeep(x); return { name: xf.name, text: xf.text, effect: xf.mechanicalEffect }; }),
            standingRules: null as { name: string; text: string }[] | null,
            opforLead: this.opforSummaryLine(spec),
            opforBehavior: this.fill(s.opforSketch?.behavior ?? ''),
            opforRows: (spec.opforForce ?? []).map((u) => {
                const src = this.data.getUnitByName(u.unitRef);
                return { chassis: u.chassis, model: u.model, tons: u.tons, bv: u.bv, bvText: this.fmt(u.bv ?? 0), icon: src?.icon, weightClass: src?.weightClass, unitType: u.unitType ?? 'mech' };
            }),
            opforTotal: {
                count: spec.opforForce?.length ?? 0, bv: spec.opforBv, bvText: this.fmt(spec.opforBv),
                mechs: (spec.opforForce ?? []).filter((u) => (u.unitType ?? 'mech') !== 'vehicle').length,
                vehicles: (spec.opforForce ?? []).filter((u) => u.unitType === 'vehicle').length,
            },
            opforSupport: null as string | null,
            timeline: (s.reactionTimeline?.entries ?? []).map((e) => ({ t: this.fill(e.t), event: this.fill(e.event) })),
            deadline: this.fill(s.reactionTimeline?.hardDeadline ?? ''),
            decisionPoints: (s.decisionPoints ?? []).map((dp) => ({
                name: dp.name,
                context: this.fill(dp.context),
                options: dp.options.map((o, i) => this.optionVm(s, dp.name, o, i)),
            })),
            logistics: [
                this.state.campaignSystem() === 'hotspots'
                    ? [`Warchest (current): ${this.fmt(this.state.warchestSP() ?? 0)} SP`, `Resource posture: ${(this.state.resources() ?? 'normal').toUpperCase()}`]
                    : [`Unit treasury (current): ${this.fmt(this.state.treasury() ?? 0)} C-bills`, `Resource posture: ${(this.state.resources() ?? 'normal').toUpperCase()}`],
                [this.rewardLine(spec), `Transport: ${this.transportLine()}`],
            ] as [string, string][],
            // intelligence reads §2, engineering+logistics close §5, naval/medical/comms hold App.A.
            sidebars: ((seen: Set<string>) => ({
                s1: [this.voiceBox('command', seen)].filter((x): x is VoiceBox => !!x),
                s2: [this.voiceBox('intelligence', seen)].filter((x): x is VoiceBox => !!x),
                s5: [this.voiceBox('engineering', seen), this.voiceBox('logistics', seen)].filter((x): x is VoiceBox => !!x),
                appA: [this.voiceBox('naval', seen), this.voiceBox('medical', seen), this.voiceBox('comms', seen)].filter((x): x is VoiceBox => !!x),
            }))(new Set<string>()),
            worldSheet: spec.theater ? {
                rows: [
                    ['Population (est.)', spec.theater.population],
                    ['Terrain', spec.theater.terrain],
                    ['Climate / season', `${spec.theater.climate} · ${spec.theater.season}`],
                    ['Gravity', spec.theater.gravity],
                    ['Day length', spec.theater.dayLength],
                    ['Infrastructure', spec.theater.infrastructure],
                    ['HPG', spec.theater.hpg],
                ] as [string, string][],
                occupation: this.fill(spec.theater.occupation),
            } : null,
            commander: this.commanderVm(),
            phases: (s.phases ?? []).map((p) => ({
                name: this.fill(p.name),
                lead: this.fill(p.lead),
                data: Object.entries(p.dataBlock ?? {}).map(([k, val]) => [this.fill(k), this.fill(val)] as [string, string]),
                routes: (p.routes ?? []).map((r) => ({ name: r.name, desc: this.fill(r.desc), tradeoff: this.fill(r.tradeoff) })),
                protocol: p.protocol ? this.protocolLines(p.protocol) : null,
                kernel: p.sidebarKernel ? this.kernelBox(p.sidebarKernel.voiceSlot, p.sidebarKernel.kernel) : null,
            })),
            assets: (s.assetDetails ?? []).map((a) => ({ ref: this.fill(a.ref), detail: this.fill(a.detail), priority: a.priority })),
            appendixA: this.appendixA(),
            appendixB: spec.comms ? {
                schedule: [spec.comms.syncSchedule, spec.comms.reportWindow],
                codewords: spec.comms.codewords,
                emergency: spec.comms.emergency,
            } : null,
            priorities: [
                { p: 'Primary', text: this.field('objectives.primary', s.objectives.primary) },
                { p: 'Secondary', text: this.field('objectives.secondary', s.objectives.secondary) },
                { p: 'Bonus', text: this.field('objectives.bonus', s.objectives.bonus) },
            ],
            forks: (s.forks ?? []).map((f) => { const ff = this.fillDeep(f); return { name: ff.name, gate: ff.outcomeGate, threat: ff.threat, trigger: ff.trigger, consequence: ff.consequence }; }),
            story: this.fill(s.storyElementSeed),
            closing: registerClosing(s.register),
            travel: spec.travel ?? null,
            operationDays: spec.operationDays ?? spec.window.engagementDays,
        };
    });

    //    COH_KEY pattern below). FRAGORD is a RENDER over the SAME vm — no new data, no prose change. At least one
    //    format is always on (toggling the last one off re-enables the other). ──
    private readonly WARN_KEY = 'bce.order.warnord';
    private readonly FRAG_KEY = 'bce.order.fragord';
    protected readonly showWarnord = signal<boolean>(this.lsBool(this.WARN_KEY, true));
    protected readonly showFragord = signal<boolean>(this.lsBool(this.FRAG_KEY, false));
    private persistOrder(): void { try { localStorage.setItem(this.WARN_KEY, this.showWarnord() ? '1' : '0'); localStorage.setItem(this.FRAG_KEY, this.showFragord() ? '1' : '0'); } catch { /* */ } }
    protected toggleWarnord(): void { const n = !this.showWarnord(); this.showWarnord.set(n); if (!n && !this.showFragord()) this.showFragord.set(true); this.persistOrder(); }
    protected toggleFragord(): void { const n = !this.showFragord(); this.showFragord.set(n); if (!n && !this.showWarnord()) this.showWarnord.set(true); this.persistOrder(); }

    private fragSituation(text: string): string {
        const t = (text ?? '').trim();
        if (!t) return t;
        const sentences = t.match(/[^.!?]+[.!?]+(?:["'’”)\]]+)?\s*/g);
        let brief = sentences && sentences.length > 2 ? sentences.slice(0, 2).join('').trim() : t;
        if (brief.length > 460) brief = brief.slice(0, 460).replace(/\s+\S*$/, '').trim() + '…'; // run-on backstop at a word boundary
        return brief;
    }

    protected readonly frag = computed(() => {
        const v = this.vm();
        const spec = this.state.missionSpec();
        if (!v || !spec) return null;
        const c = this.ctx();
        return {
            opname: v.opname,                                   // (1) heading
            matchup: `${c.EMPLOYER} → ${c.TARGET_FACTION}`,
            cycle: v.cycle,                                     //     mission-type · YEAR (era line)
            loc: v.oploc,                                       //     WORLD · DISTRICT
            threat: v.threat.replace(/^THREAT RATING — /, ''),
            brief: this.fragSituation(v.situation[0] ?? ''),
            objectives: v.priorities,                           // (3) primary / secondary / bonus
            opforLine: v.opforLead,                             // (4) the §3 one-liner (composition + BV)
            opforBv: v.opforTotal.bvText, playerBv: this.fmt(spec.playerBv),
            bvPct: spec.playerBv ? Math.round((spec.opforBv / spec.playerBv) * 100) : null,
            mechs: v.opforTotal.mechs, vehicles: v.opforTotal.vehicles, // arms mix
            decisions: v.decisionPoints.map((dp) => ({ name: dp.name, options: dp.options.map((o) => o.title) })), // (5) titles only
            deadline: v.deadline,                               // (6) the clock
            operationDays: spec.operationDays ?? spec.window.engagementDays,
            window: `${spec.window.deployByDays}-day deploy · ~${spec.window.engagementDays}-day engagement`,
            travel: spec.travel ?? null,
            force: c.FORCE_SIZE,                                // (7) force line
        };
    });

    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly trackOnly = computed(() => this.isHotspots());





    private trackTerrainLine(spec: MissionSpec): string {
        const t = spec.terrain;
        if (!t?.biome) return '';
        return t.note ? `${t.biome} — ${t.note}` : t.biome;
    }
    /** The Salvage sentence — leads with the contract's NEGOTIATED % (spec.clauses), then the track's default policy. */


    private vmThreatRow(): string {
        const spec = this.state.missionSpec();
        return `Threat Level: ${spec && spec.opforBv >= spec.playerBv ? 'HIGH' : (this.seed()?.threatRange[0] ?? 'MEDIUM')}`;
    }
    private transportLine(): string {
        const r = this.state.resources();
        if (r === 'established') return 'owned JumpShip + DropShip (Established)';
        if (r === 'normal') return 'owned DropShip; jump passage contracted';
        return 'lift bought / leased per drop (Lean — no owned transport)';
    }

    private opforSummaryLine(spec: MissionSpec): string {
        const f = spec.opforForce ?? [];
        if (!f.length) return '';
        const veh = f.filter((u) => u.unitType === 'vehicle').length;
        const mechs = f.length - veh;
        const parts = [`${mechs} BattleMech${mechs === 1 ? '' : 's'}`];
        if (veh) parts.push(`${veh} combat vehicle${veh === 1 ? '' : 's'}`);
        return `Assessed order of battle — ${parts.join(' and ')} (${f.length} units, ${this.fmt(spec.opforBv)} BV). The table below is the fielded force; doctrine and posture follow.`;
    }

    private rewardLine(spec: MissionSpec): string {
        // NOT C-bills; the synthetic offer's pay is all-zero, so never print "0 C-bills · 0/mo" here.
        if (this.state.campaignSystem() === 'hotspots') {
            return 'Reward: Hot Spots contract — Combat Pay + Salvage in Support Points on resolution (Warchest)';
        }
        const merc = this.state.force() === 'MERC';
        if (!merc && (spec.reward.total ?? 0) === 0 && (spec.reward.monthly ?? 0) === 0) {
            return 'Reward: House operation — no contract fee (standing pay & upkeep apply)';
        }
        return `Reward (contract): ${this.fmt(spec.reward.total)} C-bills · ${this.fmt(spec.reward.monthly)}/mo`;
    }

    private static readonly REGISTRY_SLOT: Record<string, OdmAarSlot> = {
        command: 'command', intelligence: 'intelligence', engineering: 'engineering',
        comms: 'intelligence',   // the relay operator IS the company's comms voice
        medical: 'personnel',    // the medic
        naval: 'naval',          // the JumpShip captain — voice block PM-delivered 2026-08-27
    };
    private registryBox(roleFamily: string): { header: string; name: string; rules: string; contactId: string } | null {
        const slot = OdmMissionPackageComponent.REGISTRY_SLOT[roleFamily];
        if (!slot) return null; // logistics — DROPPED by ruling; nothing renders
        const c = this.contacts.bySlot(slot);
        return c?.aar ? { header: c.aar.header, name: c.name, rules: c.aar.standingRules.join(' · '), contactId: c.id } : null;
    }
    private voiceBox(roleFamily: string, seen?: Set<string>): VoiceBox | null {
        const reg = this.registryBox(roleFamily);
        if (!reg) return null;
        // (Coss is intelligence AND comms), and keying by family would print her twice — exactly the
        const voiceId = `odm:${reg.contactId}`;
        const v = { sidebarHeader: reg.header, speechRules: [reg.rules] };
        if (seen) { if (seen.has(voiceId)) return null; seen.add(voiceId); }
        const rv = this.state.missionSpec()?.refinedVoices?.[roleFamily];
        const refined = !!(rv?.verified && rv.text.trim());
        // invented geography — Hill 212, the reservoir) and are NOT mission ground-truth. Only a REFINED,
        // mission-grounded (machine-verified) voice prints quoted lines; an un-refined box shows the standing-rules
        // characterization (header + speech rules) with NO phantom-geography quotes.
        const lines = refined ? rv!.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
        return { header: v.sidebarHeader, lines, rules: v.speechRules.join(' · '), refined, characterization: !refined };
    }
    private kernelBox(voiceSlot: string, kernel: string): KernelBox | null {
        const reg = this.registryBox(voiceSlot);
        if (!reg) return null;
        return { header: reg.header, subject: this.fill(kernel), line: '', rules: reg.rules };
    }
    /** §2.3 — the recurring adversary's dossier from the drawn registry NPC (persists campaign-wide). */
    private commanderVm() {
        const npc: ForgeNpc | undefined = this.pack.npcById(this.state.npcAssignments()['opfor-commander']);
        if (!npc) return null;
        return {
            name: npc.name,
            callsign: npc.callsign ?? '',
            archetype: npc.archetype.replace(/-/g, ' '),
            factions: npc.factionAffinity.join(' · '),
            history: npc.background,
            temperament: npc.traits.map((t) => t.replace(/-/g, ' ')).join(' · '),
            read: npc.voiceTags.join(' · '),
            assessment: this.commanderAssessment(npc),
        };
    }
    private commanderAssessment(npc: ForgeNpc): string {
        const t = npc.traits.slice(0, 2).map((x) => x.replace(/-/g, ' ')).join(', ');
        const all = [...(this.state.missionTree() ?? []), ...(this.state.treeArchive() ?? []).flatMap((e) => e.tree)];
        const faced = all.some((b) => b.state === 'RESOLVED' && b.resolution?.aar?.npcFlags?.includes('opfor-commander'));
        return `ASSESSMENT: ${t}${t ? ' — ' : ''}${faced ? 'has been engaged by this command before; expect adapted dispositions.' : 'has not been tested against this command.'}`;
    }
    /** Appendix A — support/naval status from the ACTUAL campaign (tier-true; charter figures are
     *  INTERIM planning texture, flagged in theater.ts — T-022/T-025 price the real economy). */
    private appendixA(): { rows: [string, string][]; naval: [string, string] | null } {
        const tier = this.state.resources() ?? 'normal';
        const rows: [string, string][] = tier === 'established' ? [
            ['Owned JumpShip (Invader-class)', 'ON STATION — K-F recharge cycle ~7 days; schedule rides the command net'],
            ['Owned DropShips', 'OPERATIONAL — combat drop and recovery organic to the command'],
            ['Charter requirement', 'NONE — lift is owned; charter only for surge capacity'],
        ] : tier === 'normal' ? [
            ['Owned DropShip', 'OPERATIONAL — one hull; its loss strands the command'],
            ['Jump passage', `CONTRACTED per jump — ~${this.fmt(SUPPORT_TUNABLES.charterJumpPerCollar)} C-bills per collar (planning figure)`],
            ['Surge lift', `CHARTER on demand — ~${this.fmt(SUPPORT_TUNABLES.charterDropshipPerDrop)} C-bills per drop (planning figure)`],
        ] : [
            ['Owned lift', 'NONE — Lean posture; every movement is bought'],
            ['DropShip charter', `~${this.fmt(SUPPORT_TUNABLES.charterDropshipPerDrop)} C-bills per drop (planning figure)`],
            ['Jump passage', `~${this.fmt(SUPPORT_TUNABLES.charterJumpPerCollar)} C-bills per collar per jump (planning figure)`],
        ];
        const npc = this.pack.npcById(this.state.npcAssignments()['naval-contact']);
        const naval: [string, string] | null = npc
            ? [`Naval contact — ${npc.name}`, `RETAINED — activation via the App. B emergency net; retainer ~${this.fmt(SUPPORT_TUNABLES.retainerNavalContact)} C-bills/mo (planning figure)`]
            : null;
        return { rows, naval };
    }

    private optionVm(seed: MissionSeed, dpName: string, oRaw: MissionSeed['decisionPoints'][number]['options'][number], idx: number): OptionVm {
        const o = this.fillDeep(oRaw);
        const treasury = this.state.treasury() ?? 0;
        const tier = this.state.resources();
        // gate: an option-title gate beats a decision-point gate (matched on the RAW title so the gate map keys line up).
        const gate = gateFor(seed, oRaw.title) ?? gateFor(seed, dpName);
        let locked = false;
        let gateNote: string | null = null;
        let repriceText: string | null = null;
        if (gate && !gateMet(gate.requires, tier, treasury)) {
            if (gate.whenLacking === 'lock') { locked = true; gateNote = `LOCKED — requires ${gate.requires.replace(/-/g, ' ')}`; }
            else { repriceText = this.fill(gate.lackingText); }
        }
        let costLine: string | null = null;
        let treasuryAfter: string | null = null;
        const co = o.costs;
        if (co) {
            costLine = 'OPERATION COST — ' + (costParts(co).join(' · ') || 'no direct cost');
            if (co.cbills != null && co.cbills > 0) treasuryAfter = `${this.fmt(treasury - co.cbills)} C-bills`;
        }
        return { title: `OPTION ${idx + 1} — ${o.title}`, advantages: o.advantages, disadvantages: o.disadvantages, consequence: this.fill(o.consequence), costLine, treasuryAfter, locked, gateNote, repriceText };
    }

    private templateSituation(s: MissionSeed, spec: MissionSpec): string[] {
        return [
            ...(spec.forge?.continuityLead ? [this.fill(spec.forge.continuityLead)] : []),
            ...(spec.forge?.branchLead ? [this.fill(spec.forge.branchLead)] : []),
            ...this.fill(s.situation).split(/\n{2,}|(?<=\.)\s{2,}/).filter((p) => p.trim().length > 40),
        ];
    }
    private situationParas(s: MissionSeed, spec: MissionSpec): string[] {
        const r = spec.refined?.['situation'];
        if (r?.verified && r.text.trim()) return r.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        return this.templateSituation(s, spec);
    }

    protected readonly canRefine = computed(() => this.narrator.mode() === 'local' && this.narrator.briefingsOn() && this.hasSeed());
    protected readonly refining = this.narrator.busy;
    protected readonly results = this.narrator.lastRun;

    async refine(): Promise<void> {
        const s = this.seed();
        const spec = this.state.missionSpec();
        if (!s || !spec) return;
        const c = this.ctx();
        const register = this.state.force() === 'MERC' ? 'merc' : this.seed()?.register ?? '';

        const log: NonNullable<MissionSpec['refineLog']> = [];

        let nextRefined = spec.refined ?? {};
        const situationBefore = this.templateSituation(s, spec).join('\n\n');
        if (situationBefore.trim()) {
            const names = [c.WORLD, c.DISTRICT, c.TARGET_FACTION, c.EMPLOYER, c.FORCE_SIZE, c.YEAR, ...Object.values(c.specifics).map(String)].filter(Boolean);
            const target: RefineTarget = { id: 'situation', label: 'Intelligence picture (§2)', roleFamily: 'intelligence', text: situationBefore, names };
            const results = await this.narrator.refine([target], register, (rf) => this.voiceCard(rf));
            const r0 = results[0];
            if (r0?.status === 'accepted' && r0.text) nextRefined = { ...nextRefined, situation: { text: r0.text, verified: true } };
            if (r0) log.push({ kind: 'situation', label: '§2 Intelligence picture', status: r0.status, before: situationBefore, after: r0.text, gate: r0.gate });
        }

        // Jobs 1+2 (the headline) — mission-aware voice + the coherence verdict, over the whole package
        let nextVoices = spec.refinedVoices ?? {};
        let nextCoherence = spec.coherence;
        const boxes = this.voiceTargets();
        const pkg = this.assembledPackage();
        if (boxes.length && pkg) {
            const wm = await this.narrator.refineWholeMission(pkg, boxes, register, this.lockedManifest());
            for (const vb of wm.voices) {
                if (vb.status === 'accepted' && vb.text) nextVoices = { ...nextVoices, [vb.id]: { text: vb.text, verified: true } };
                const box = boxes.find((b) => b.id === vb.id);
                log.push({ kind: 'voice', label: box?.header || vb.id, status: vb.status, before: (box?.stub ?? []).join('  '), after: vb.text, gate: vb.gate });
            }
            if (wm.coherence) nextCoherence = wm.coherence;
        }

        // this only persists what the pass already produced (accepted text, rejected reasons, the verdict).
        const refinedModel = nextCoherence?.model || this.narrator.activeModel() || 'local';
        this.state.setMissionSpec({ ...spec, refined: nextRefined, refinedVoices: nextVoices, coherence: nextCoherence, refineLog: log, refinedAt: Date.now(), refinedModel });
        void this.store.persistCurrent();
        this.setCohOpen(true); // first appearance after a refine = shown; thereafter the GM's toggle holds
    }

    /** GM-only coherence verdict (Job 2), display-only — rendered as the COHERENCE panel. */
    protected readonly coherence = computed(() => this.state.missionSpec()?.coherence ?? null);

    /** Any narrator refinement present → the package carries the ✦ REFINED stamp + the GM panel toggle. */
    protected readonly refined = computed(() => {
        const sp = this.state.missionSpec();
        return !!(sp && (sp.refined?.['situation']?.verified || (sp.refinedVoices && Object.keys(sp.refinedVoices).length) || sp.coherence));
    });
    protected readonly refinedStamp = computed(() => {
        const sp = this.state.missionSpec();
        return this.refined() ? { model: sp?.refinedModel || sp?.coherence?.model || 'local', at: sp?.refinedAt || 0 } : null;
    });
    protected readonly refineLog = computed(() => this.state.missionSpec()?.refineLog ?? []);
    protected stampTime(at: number): string {
        return at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    }
    /** The before→after word diff for one change-log entry (prose only; reuses the bakeoff algorithm). */
    protected proseDiff(before: string, after: string | null): DiffToken[] {
        return diffAfter(before, after ?? '');
    }

    private readonly COH_KEY = 'bce.coh.open';
    protected readonly cohOpen = signal<boolean>(this.lsBool(this.COH_KEY, true));
    private lsBool(k: string, d: boolean): boolean { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } }
    private setCohOpen(v: boolean): void { this.cohOpen.set(v); try { localStorage.setItem(this.COH_KEY, v ? '1' : '0'); } catch { /* */ } }
    protected toggleCoh(): void { this.setCohOpen(!this.cohOpen()); }
    protected closeCoh(): void { this.setCohOpen(false); }
    @HostListener('document:keydown.escape')
    protected onEsc(): void { if (this.cohOpen() && this.coherence()) this.setCohOpen(false); }

    private readonly VOICE_FAMILIES = ['command', 'intelligence', 'engineering', 'logistics', 'naval', 'medical', 'comms'];
    /** The staff-voice boxes present on this package → the Job-1 rewrite targets. */
    private voiceTargets(): VoiceBoxTarget[] {
        const out: VoiceBoxTarget[] = [];
        for (const fam of this.VOICE_FAMILIES) {
            const reg = this.registryBox(fam);
            if (!reg) continue;
            out.push({ id: fam, header: reg.header, name: reg.name, speechRules: [reg.rules], stub: [], commentOn: this.commentFor(fam) });
        }
        return out;
    }
    private commentFor(fam: string): string {
        switch (fam) {
            case 'command': return "the commander's read on this operation and the decision the unit faces";
            case 'intelligence': return 'the opposing force, the threat, and what the situation actually means here';
            case 'engineering': return 'the maintenance/repair posture and what this operation will cost the machines';
            case 'logistics': return 'transport, supply, and the deploy/engagement window';
            case 'naval': return 'lift, jump coverage, and the extraction';
            case 'medical': return 'casualty handling and the personnel risk of this op';
            case 'comms': return 'the comms plan, codewords, and signal discipline for this op';
            default: return 'this operation';
        }
    }
    /** The whole assembled package as plain prose (the model's context). Capped to fit the smaller
     *  context windows (the 26B at -c 8192); the 12B/31B at 16k have headroom. */
    private assembledPackage(): string {
        const v = this.vm();
        if (!v) return '';
        const cmd = this.commanderVm();
        const L: string[] = [];
        L.push(`OPERATION: ${v.opname} — ${v.oploc} · ${v.cycle}`, v.threat);
        L.push(`FROM ${v.transmission.from} · TO ${v.transmission.to} · RE: ${v.transmission.re}`);
        L.push('WARNING ORDER:'); for (const [a, b] of v.warnord) L.push(`  ${a} — ${b}`);
        L.push(`COMMANDER'S INTENT: ${v.intent}`);
        L.push('SITUATION:', ...v.situation.map((p) => '  ' + p));
        if (cmd) L.push(`OPFOR COMMANDER: ${cmd.name}${cmd.callsign ? ' "' + cmd.callsign + '"' : ''} — ${cmd.archetype}. ${cmd.history} ${cmd.assessment}`);
        L.push(`OPFOR: ${(v.opforLead + ' ' + v.opforBehavior).trim()}`, `  composition: ${v.opforTotal.count} units, total BV ${v.opforTotal.bv}`);
        for (const r of v.opforRows.slice(0, 12)) L.push(`  ${r.chassis} ${r.model} (${r.tons}t, BV ${r.bv})`);
        if (v.timeline.length) { L.push('REACTION TIMELINE:'); for (const e of v.timeline) L.push(`  ${e.t} — ${e.event}`); }
        if (v.deadline) L.push(`HARD DEADLINE: ${v.deadline}`);
        if (v.decisionPoints.length) { L.push('DECISION POINTS:'); for (const dp of v.decisionPoints) { L.push(`  ${dp.name}: ${dp.context}`); for (const o of dp.options) L.push(`    ${o.title} — ${o.consequence}${o.costLine ? ' [' + o.costLine + ']' : ''}`); } }
        L.push('LOGISTICS:'); for (const [a, b] of v.logistics) L.push(`  ${a} — ${b}`);
        if (v.complications?.length) { L.push('COMPLICATIONS:'); for (const x of v.complications) L.push(`  ${x.name}: ${x.text} (${x.effect})`); }
        if (v.standingRules?.length) { L.push('STANDING TRACK RULES:'); for (const r of v.standingRules) L.push(`  ${r.name}: ${r.text}`); }
        if (v.worldSheet) { L.push('WORLD SHEET:'); for (const [k, val] of v.worldSheet.rows) L.push(`  ${k}: ${val}`); }
        return L.join('\n').slice(0, 16000);
    }
    /** The locked proper-noun manifest for the voice rewrite (numbers are auto-extracted from the package). */
    private lockedManifest(): string[] {
        const c = this.ctx();
        const v = this.vm();
        const cmd = this.commanderVm();
        const names = [c.WORLD, c.DISTRICT, c.TARGET_FACTION, c.EMPLOYER, c.FORCE_SIZE, c.YEAR, v?.opname, cmd?.name, cmd?.callsign, ...Object.values(c.specifics).map(String)]
            .filter((x): x is string => !!x && x !== '—');
        return [...new Set(names)];
    }
    private voiceCard(roleFamily: string | null): { name: string; speechRules: string[] } | null {
        if (!roleFamily) return null;
        const reg = this.registryBox(roleFamily);
        return reg ? { name: reg.name, speechRules: [reg.rules] } : null;
    }

    protected onClose(): void {
        this.close.emit();
    }
    protected onPrint(): void {
        window.print();
    }
}

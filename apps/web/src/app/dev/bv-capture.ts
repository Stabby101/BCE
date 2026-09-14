/*
 * BCE dev seam (REBASE-1 P1, ruling #8) — the COMPUTED-BV witness the goldens cannot see.
 *
 * The regression goldens capture the RESOLVE flow (tiers/pay/salvage) but NEVER read
 * CBTForceUnit.getBv() — the computed value (base + TAG + c3 + skill-adjusted) that actually renders on
 * every record sheet / roster / AS card (harness.mjs:27-42; the SLICE-1 precedent). A MekBay re-baseline
 * moves computed BV (BV rounding, ammo multipliers, ppc/gauss, TAG tax, c3 rework). This seam captures it
 * BEFORE the rebase so every post-rebase BV delta is attributable (law 4) instead of invisible.
 *
 * TWO passes, because record-sheet loading needs a per-unit SVG (fetched from the sheet host):
 *   - catalog(from,to): every catalog unit as a LONE unit, WITHOUT loading a sheet. getBaseBv = the
 *     catalog `bv` (+ custom-ammo variation, 0 for a stock unit); getBv = the pure, static
 *     BVCalculatorUtil.calculateAdjustedBV at a canonical 4/5. For a lone stock unit TAG/c3/external are 0,
 *     so this IS getBv for the overwhelming majority — and it isolates the two dominant delta sources
 *     (catalog BV + the skill matrix) across the WHOLE catalog with no network.
 *   - forceOf(names): the ODM roster + each opfor-spec FIXED block, LOADED (sheets fetched), so force-wide
 *     TAG semi-guided ammo AND c3 networks are exercised — the real getBaseBv/tagBV/c3Tax/getBv in context.
 *
 * OPT-IN, dev-only: does NOTHING unless localStorage['bce.test.bvcapture'] is set; it only reads (throwaway
 * forces, never campaign state). OURS file — survives the wholesale replace; its `Unit`/`models/units.model`
 * + `BVCalculatorUtil` imports are R0.3 edges P1 re-points at the pin.
 */
import type { Injector } from '@angular/core';
import { runInInjectionContext } from '@angular/core';
import { DataService } from '../services/data.service';
import { UnitInitializerService } from '../services/unit-initializer.service';
import { CBTForce } from '../models/cbt-force.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { C3NetworkType } from '../models/c3-network.model';
import type { SerializedC3NetworkGroup } from '../models/force-serialization';
import type { UnitSummary as Unit } from '../models/unit-summary.model';

const CANON_GUNNERY = 4, CANON_PILOTING = 5; // a canonical Regular pilot — the fixed skill the witness scores at

interface BvRow { name: string; id: number; base?: number; tag?: number; c3?: number; bv?: number; error?: string }

export function installBvCapture(injector: Injector): void {
    try {
        if (typeof localStorage === 'undefined' || !localStorage.getItem('bce.test.bvcapture')) return;
    } catch { return; }
    const ds = injector.get(DataService);
    const ui = injector.get(UnitInitializerService);
    (window as unknown as Record<string, unknown>)['__bvCapture'] = {
        // SLICE-1 loads era slices lazily; force the FULL catalog so "every catalog unit" is really every one.
        loadFull: async (): Promise<number> => { await ds.ensureFullCatalog(); return ds.getUnits().length; },
        ready: () => { try { return ds.isFullLoaded() && ds.getUnits().length > 0; } catch { return false; } },
        count: () => ds.getUnits().length,
        // the "every catalog unit" pass — no sheet load; base BV + the pure skill-adjusted BV at 4/5
        catalog: (from: number, to: number): BvRow[] => ds.getUnits().slice(from, to).map((u: Unit) => {
            const base = Math.round(u.bv ?? 0);
            return { name: u.name, id: u.id, base, bv: BVCalculatorUtil.calculateAdjustedBV(u, base, CANON_GUNNERY, CANON_PILOTING) };
        }),
        // a LOADED LONE pass by unit name (each unit in its OWN throwaway force — the stratified sample):
        // sheets fetched, so the ENGINE's BV code runs (getBaseBv recompute, custom-ammo variation, and any
        // equipment-linking BV the pin introduces). tagBV/c3Tax are the unit's own (0 for a stock lone unit).
        loadedLone: async (names: string[]): Promise<BvRow[]> => {
            return await runInInjectionContext(injector, async () => {
                const catalog = ds.getUnits();
                const out: BvRow[] = [];
                for (const n of names) {
                    const u = catalog.find((x) => x.name === n);
                    if (!u) { out.push({ name: n, id: -1, error: 'not in catalog' }); continue; }
                    try {
                        const force = new CBTForce('BVCAP-LONE', ds, ui, injector);
                        const fu = force.addUnit(u);
                        await fu.load();
                        out.push({ name: n, id: u.id, base: fu.getBaseBv(), tag: fu.tagBV(), c3: fu.c3Tax(), bv: fu.getBv() });
                    } catch (e) { out.push({ name: n, id: u.id, error: String((e as Error)?.message ?? e).slice(0, 80) }); }
                }
                return out;
            });
        },
        // a C3 NETWORK pass — loads the units AND LINKS them into a real network (force.setNetwork), so
        // c3Tax is actually exercised (a bare force never forms a network; _c3Networks starts empty). kind
        // 'c3' → names[0] is the master, the rest slaves; 'c3i' → all peers. Returns per-unit BV + c3Tax sum.
        c3NetworkOf: async (kind: 'c3' | 'c3i', names: string[]): Promise<{ units: BvRow[]; total: number; c3TaxSum: number }> => {
            return await runInInjectionContext(injector, async () => {
                const catalog = ds.getUnits();
                const force = new CBTForce('BVCAP-C3', ds, ui, injector);
                const fus = names.map((n) => { const u = catalog.find((x) => x.name === n); return u ? force.addUnit(u) : null; });
                for (const fu of fus) { if (fu) { try { await fu.load(); } catch { /* */ } } }
                const live = fus.map((fu) => (fu ? (fu as unknown as { id: string }).id : null)).filter((x): x is string => !!x);
                if (live.length >= 2) {
                    const group: SerializedC3NetworkGroup = kind === 'c3'
                        ? { id: 'bvcap-net', type: C3NetworkType.C3, color: '#ffffff', masterId: live[0], masterCompIndex: 0, members: live.slice(1) }
                        : { id: 'bvcap-net', type: C3NetworkType.C3I, color: '#ffffff', peerIds: live };
                    force.setNetwork([group]);
                }
                const units: BvRow[] = fus.map((fu, i) => {
                    if (!fu) return { name: names[i], id: -1, error: 'not in catalog' };
                    try { return { name: names[i], id: (fu as unknown as { getUnit(): Unit }).getUnit().id, base: fu.getBaseBv(), tag: fu.tagBV(), c3: fu.c3Tax(), bv: fu.getBv() }; }
                    catch (e) { return { name: names[i], id: -1, error: String((e as Error)?.message ?? e).slice(0, 80) }; }
                });
                return { units, total: units.reduce((s, r) => s + (r.bv ?? 0), 0), c3TaxSum: units.reduce((s, r) => s + (r.c3 ?? 0), 0) };
            });
        },
        // STEP 1c — the ONE deliberate CUSTOM case: a TAG carrier whose LRM ammo crit is SWAPPED to a
        // semi-guided variant through the loadout seam (getAvailableEquipment + setCritSlot), so tagBV is
        // NON-ZERO and the "no SG tag tax for core2026" change has a witness (a real value, not zero-to-zero).
        taggedCustom: async (unitName: string, ammoId: string): Promise<Record<string, unknown>> => {
            return await runInInjectionContext(injector, async () => {
                const u = ds.getUnits().find((x) => x.name === unitName);
                if (!u) return { unitName, ammoId, error: 'not in catalog' };
                const force = new CBTForce('BVCAP-TAG', ds, ui, injector);
                const fu = force.addUnit(u);
                await fu.load();
                const read = (): BvRow => ({ name: unitName, id: u.id, base: fu.getBaseBv(), tag: fu.tagBV(), c3: fu.c3Tax(), bv: fu.getBv() });
                const before = read();
                // REBASE-1 P1 (e): the fork's fu.getAvailableEquipment() was removed upstream. The semi-guided
                // ammo object is resolved straight from the full registry by id/name (loadFull is resident here).
                const semi = ds.getEquipmentRegistry().findEquipment(ammoId) ?? undefined;
                let swapped = false; let critName: string | null = null;
                if (semi) {
                    const crits = fu.getCritSlots() as { eq?: { name?: string }; name?: string; originalName?: string }[];
                    const target = crits.find((c) => c.eq && /Ammo/i.test(c.eq.name || '') && /LRM/i.test(c.eq.name || ''));
                    if (target) {
                        critName = target.eq?.name ?? null;
                        (fu as unknown as { setCritSlot(s: unknown): void }).setCritSlot({ ...target, eq: semi, name: semi.name, originalName: target.originalName ?? target.name });
                        swapped = true;
                    }
                }
                return { unitName, id: u.id, ammoId, hadSemiEquip: !!semi, swapped, swappedCrit: critName, before, after: read() };
            });
        },
        // a FORCE pass by unit name (the ODM roster + each opfor-spec FIXED block) — LOADED, scored in
        // context (force-wide TAG ammo), so tagBV is real. Per-unit + total.
        forceOf: async (names: string[]): Promise<{ units: BvRow[]; total: number }> => {
            return await runInInjectionContext(injector, async () => {
                const force = new CBTForce('BVCAP-FORCE', ds, ui, injector);
                const catalog = ds.getUnits();
                const fus = names.map((n) => {
                    const u = catalog.find((x) => x.name === n || `${x.chassis} ${x.model}`.trim() === n);
                    return u ? force.addUnit(u) : null;
                });
                for (const fu of fus) { if (fu) { try { await fu.load(); } catch { /* sheet may be unreachable; BV still reads from comp where possible */ } } }
                const units: BvRow[] = fus.map((fu, i) => {
                    if (!fu) return { name: names[i], id: -1, error: 'not in catalog' };
                    try { return { name: names[i], id: (fu as unknown as { getUnit(): Unit }).getUnit().id, base: fu.getBaseBv(), tag: fu.tagBV(), c3: fu.c3Tax(), bv: fu.getBv() }; }
                    catch (e) { return { name: names[i], id: -1, error: String((e as Error)?.message ?? e).slice(0, 80) }; }
                });
                const total = units.reduce((s, r) => s + (r.bv ?? 0), 0);
                return { units, total };
            });
        },
    };
    console.log('[bvcapture] installed — window.__bvCapture ready');
}

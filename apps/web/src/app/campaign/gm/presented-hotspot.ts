import { resolveSides, opposingFaction, type CatalogHotSpot } from '../chaos/hotspots-catalog';
import { resolved } from '../chaos/chaos-contract';

export interface PresentedSide {
    key: 'a' | 'b';
    title?: string;
    employer: string;    // who hires you (display)
    role: string;        // attacker | defender
    vs: string;          // the opposing faction's NAME only — "Force strength undisclosed" stays true
    blurb?: string;      // the side teaser (synthesized sides excluded — the provisional line is GM noise)
    synthesized?: boolean;
}

export interface PresentedHotspot {
    id: string;
    title: string;
    world: string;
    type: string;
    scale: number;
    employer: string;      // the top-level/side-A employer line
    employerDesc?: string;
    op?: string;
    description?: string;  // the system profile's flavor description
    systemRows: { label: string; value: string }[];
    transit: { jumpDays: number | null; rechargeHours: number | null; net: number; cover: number };
    sides: PresentedSide[];
    presentedAt: number;   // epoch ms — presentation order/recency on the player device
}

function sysRows(h: CatalogHotSpot): { label: string; value: string }[] {
    const s = h.systemProfile; const out: { label: string; value: string }[] = [];
    const add = (label: string, v: unknown, suffix = ''): void => { if (v != null && v !== '') out.push({ label, value: `${v}${suffix}` }); };
    add('Star', s.starType); add('Position', s.positionInSystem); add('Gravity', s.surfaceGravity, ' g');
    add('Atmosphere', s.atmPressure); add('Mean temp', s.equatorialTempC, ' °C'); add('Climate', s.climate);
    add('Surface water', s.surfaceWaterPct, '%'); add('Satellites', s.satellites); add('Native life', s.highestNativeLife);
    add('HPG', s.hpgClass); add('Recharge station', s.rechargeStation);
    add('Population', s.population != null ? s.population.toLocaleString('en-US') : null, s.populationYear ? ` (${s.populationYear})` : '');
    add('Socio-industrial', s.socioIndustrial); add('Capital', s.capitalCity);
    add('Landmasses', s.landmasses && s.landmasses.length ? s.landmasses.join(', ') : null);
    return out;
}

/** Build the player-safe presented record for a hotspot (both sides). Pure; GM-side only. */
export function buildPresentedBrief(h: CatalogHotSpot, at: number): PresentedHotspot {
    const pair = resolveSides(h);
    const sides: PresentedSide[] = (['a', 'b'] as const)
        .map((key) => {
            const so = key === 'a' ? pair.a : pair.b;
            if (!so) return null;
            return {
                key,
                ...(so.title ? { title: so.title } : {}),
                employer: so.employer,
                role: so.role,
                vs: opposingFaction(h, key), // NAME only — never composition/BV
                ...(so.blurb && !so.synthesized ? { blurb: so.blurb } : {}),
                ...(so.synthesized ? { synthesized: true } : {}),
            } as PresentedSide;
        })
        .filter((s): s is PresentedSide => !!s);
    const gross = 300 * h.contract.scale;
    const cover = Math.round((gross * resolved(h.contract.steps).transport) / 100);
    return {
        id: h.id,
        title: h.title,
        world: h.world,
        type: h.type,
        scale: h.contract.scale,
        employer: h.employer,
        ...(h.employerDesc ? { employerDesc: h.employerDesc } : {}),
        ...(h.blurb || h.situation ? { op: h.blurb || h.situation } : {}),
        ...(h.systemProfile.description ? { description: h.systemProfile.description } : {}),
        systemRows: sysRows(h),
        transit: { jumpDays: h.systemProfile.timeToJumpPointDays ?? null, rechargeHours: h.systemProfile.rechargeHours ?? null, net: gross - cover, cover },
        sides,
        presentedAt: at,
    };
}

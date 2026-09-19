// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';

export interface UnitVariantGroupIdentity {
    chassis: string;
    asType: string;
    omni: boolean;
}

export type UnitVariantGroupLike = Pick<UnitSummary, 'chassis' | 'as' | 'omni'>;

export function getUnitVariantGroupIdentity(unit: UnitVariantGroupLike): UnitVariantGroupIdentity {
    return {
        chassis: solveChassis(unit.chassis),
        asType: unit.as.TP,
        omni: !!unit.omni,
    };
}

// BCE-EDIT (P8, 2026-09-18): a slim SLICE unit carries no `as` block — the key must not throw on it (it took the whole
// data-service initialize() down from the tag fixer). A missing type keys as '' — such units never group with real ones.
export function getUnitVariantGroupKey(unit: UnitVariantGroupLike): string {
    return `${solveChassis(unit.chassis)}|${unit.as?.TP ?? ''}${!!unit.omni?'|O':''}`;
}

export function isSameVariantGroup(source: UnitVariantGroupLike, target: UnitVariantGroupLike): boolean {
    return solveChassis(source.chassis) === solveChassis(target.chassis)
        && source.as?.TP === target.as?.TP
        && !!source.omni === !!target.omni;
}

export function unitMatchesVariantGroup(unit: UnitVariantGroupLike, group: UnitVariantGroupIdentity): boolean {
    return solveChassis(unit.chassis) === group.chassis
        && unit.as.TP === group.asType
        && !!unit.omni === group.omni;
}

function solveChassis(chassis: string): string {
    if (chassis.startsWith('Hatamoto-')) {
        return 'Hatamoto';
    }
    return chassis;
}
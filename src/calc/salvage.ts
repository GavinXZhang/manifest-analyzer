/**
 * Salvage planning: dead and weak units pooled by compatible product family.
 * The plan is a pure function of check-in tallies + the parts book, so the
 * same input always yields the same suggestions.
 */

export interface PartValue {
  name: string;
  low: number;
  high: number;
}

export interface FamilyDef {
  family: string;
  parts: PartValue[];
  /** True while the values are still the owner's seeded guesses. */
  estimated: boolean;
}

export interface SalvageLine {
  lineItemId: number;
  description: string;
  family: string | null;
  dead: number;
  weakBattery: number;
  incomplete: number;
}

export interface FamilyPlan {
  family: string;
  dead: number;
  weakBattery: number;
  incomplete: number;
  lines: { lineItemId: number; description: string; dead: number; weakBattery: number; incomplete: number }[];
  /** Working units recoverable by moving parts from dead units into weak ones. */
  cannibalize: number;
  parts: PartValue[];
  /** Σ part values, per dead unit. */
  perUnitFloor: { low: number; high: number };
  /** perUnitFloor × dead. */
  floor: { low: number; high: number };
  estimated: boolean;
}

export interface SalvagePlan {
  families: FamilyPlan[];
  unmatched: SalvageLine[];
  totalDead: number;
  totalWeak: number;
  floor: { low: number; high: number };
}

export function buildSalvagePlan(lines: SalvageLine[], families: FamilyDef[]): SalvagePlan {
  const byFamily = new Map<string, FamilyPlan>();
  const unmatched: SalvageLine[] = [];
  let totalDead = 0;
  let totalWeak = 0;

  for (const line of lines) {
    if (line.dead === 0 && line.weakBattery === 0 && line.incomplete === 0) continue;
    totalDead += line.dead;
    totalWeak += line.weakBattery;
    const def = line.family ? families.find((f) => f.family === line.family) : undefined;
    if (!def) {
      unmatched.push(line);
      continue;
    }
    let plan = byFamily.get(def.family);
    if (!plan) {
      const low = def.parts.reduce((s, p) => s + p.low, 0);
      const high = def.parts.reduce((s, p) => s + p.high, 0);
      plan = {
        family: def.family,
        dead: 0,
        weakBattery: 0,
        incomplete: 0,
        lines: [],
        cannibalize: 0,
        parts: def.parts,
        perUnitFloor: { low, high },
        floor: { low: 0, high: 0 },
        estimated: def.estimated,
      };
      byFamily.set(def.family, plan);
    }
    plan.dead += line.dead;
    plan.weakBattery += line.weakBattery;
    plan.incomplete += line.incomplete;
    plan.lines.push({
      lineItemId: line.lineItemId,
      description: line.description,
      dead: line.dead,
      weakBattery: line.weakBattery,
      incomplete: line.incomplete,
    });
  }

  const plans = [...byFamily.values()];
  for (const p of plans) {
    p.cannibalize = Math.min(p.dead, p.weakBattery);
    p.floor = { low: p.perUnitFloor.low * p.dead, high: p.perUnitFloor.high * p.dead };
  }
  // Biggest opportunity first.
  plans.sort((a, b) => b.floor.high - a.floor.high || b.dead - a.dead);

  return {
    families: plans,
    unmatched,
    totalDead,
    totalWeak,
    floor: {
      low: plans.reduce((s, p) => s + p.floor.low, 0),
      high: plans.reduce((s, p) => s + p.floor.high, 0),
    },
  };
}

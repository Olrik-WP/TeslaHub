import type { ChargingSession, CostOverride } from '../api/queries';

interface CostLayer {
  bottom: number;
  top: number;
  cost: number;
}

export interface StackResult {
  totalCostConsumed: number;
  totalCostAvailable: number;
  costPerKm: number | null;
  isSubscription: boolean;
  layerCount: number;
}

function resolveChargeCost(
  session: ChargingSession,
  costSource: string,
  overrides: CostOverride[] | undefined,
): { cost: number | null; isSubscription: boolean } {
  if (costSource === 'teslahub') {
    const override = overrides?.find((o) => o.chargingProcessId === session.id);
    if (override?.location?.pricingType === 'subscription') {
      return { cost: 0, isSubscription: true };
    }
    if (override) {
      return { cost: override.isFree ? 0 : override.totalCost, isSubscription: false };
    }
    return { cost: null, isSubscription: false };
  }
  return { cost: session.cost ?? null, isSubscription: false };
}

/**
 * Build a LIFO cost stack from completed charging sessions and compute
 * how much cost has been consumed based on the current battery level.
 *
 * Each charge defines a battery band [startBat, endBat]. A more recent
 * charge overwrites any overlapping portion of older charges. We walk
 * from newest to oldest, shrinking a "threshold" that tracks the lowest
 * battery level already covered.
 */
export function computeCostStack(
  charges: ChargingSession[] | undefined,
  currentBat: number | null | undefined,
  costSource: string,
  overrides: CostOverride[] | undefined,
  kmSinceCharge: number,
  convertDistance: (km: number) => number | null,
): StackResult | null {
  if (!charges || currentBat == null) return null;

  const completed = charges.filter((s) => s.endDate);
  if (completed.length === 0) return null;

  const layers: CostLayer[] = [];
  let threshold = Infinity;
  let hasSubscription = false;

  for (const session of completed) {
    const startBat = session.startBatteryLevel;
    const endBat = session.endBatteryLevel;
    if (startBat == null || endBat == null || endBat <= startBat) continue;

    const effectiveTop = Math.min(endBat, threshold);
    const effectiveBottom = startBat;

    if (effectiveTop <= effectiveBottom) continue;

    const { cost, isSubscription } = resolveChargeCost(session, costSource, overrides);
    if (isSubscription) hasSubscription = true;
    if (cost == null) {
      threshold = Math.min(threshold, effectiveBottom);
      continue;
    }

    const originalSize = endBat - startBat;
    const effectiveSize = effectiveTop - effectiveBottom;
    const layerCost = cost * (effectiveSize / originalSize);

    layers.push({ bottom: effectiveBottom, top: effectiveTop, cost: layerCost });
    threshold = Math.min(threshold, effectiveBottom);
  }

  if (layers.length === 0) {
    if (hasSubscription) {
      return { totalCostConsumed: 0, totalCostAvailable: 0, costPerKm: null, isSubscription: true, layerCount: 0 };
    }
    return null;
  }

  let totalCostConsumed = 0;
  let totalCostAvailable = 0;

  for (const layer of layers) {
    totalCostAvailable += layer.cost;
    const layerSize = layer.top - layer.bottom;
    const consumed = Math.max(0, layer.top - Math.max(currentBat, layer.bottom));
    totalCostConsumed += layer.cost * (consumed / layerSize);
  }

  totalCostConsumed = Math.min(totalCostConsumed, totalCostAvailable);

  const km = convertDistance(kmSinceCharge);
  const costPerKm =
    totalCostConsumed > 0 && km != null && km >= 1
      ? totalCostConsumed / km
      : null;

  return {
    totalCostConsumed,
    totalCostAvailable,
    costPerKm,
    isSubscription: hasSubscription && layers.every((l) => l.cost === 0),
    layerCount: layers.length,
  };
}

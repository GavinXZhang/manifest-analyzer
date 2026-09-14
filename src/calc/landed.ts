/**
 * What one unit actually cost to get onto the shelf: winning bid + buyer's
 * premium + freight, spread over every manifest unit. This is the cost basis
 * every working unit carries into inventory after check-in.
 */
export function landedTotal(finalPrice: number, buyersPremiumRate: number, freight: number): number {
  return Math.round((finalPrice * (1 + buyersPremiumRate) + freight) * 100) / 100;
}

export function landedUnitCost(
  finalPrice: number,
  buyersPremiumRate: number,
  freight: number,
  totalUnits: number,
): number | null {
  if (totalUnits <= 0) return null;
  return Math.round((landedTotal(finalPrice, buyersPremiumRate, freight) / totalUnits) * 100) / 100;
}

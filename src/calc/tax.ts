/**
 * Massachusetts set-aside estimator for a sole-proprietor reseller.
 *
 * PLANNING ESTIMATE ONLY — not tax advice. Rates encoded here (verify yearly):
 *  - Federal self-employment tax: 15.3% on 92.35% of net earnings (owed once
 *    net self-employment earnings reach $400; the Social Security wage-base
 *    cap is ignored — irrelevant at typical reseller scale).
 *  - Half of SE tax is deductible from income before income tax.
 *  - Federal income tax: user-estimated marginal rate (bracket math is out of
 *    scope; the user sets their rate in Profile).
 *  - MA personal income tax: 5.0% flat.
 *  - MA sales tax: 6.25% on direct (non-marketplace) retail sales; online
 *    marketplaces collect and remit for you as marketplace facilitators.
 */

export const SE_TAX_RATE = 0.153;
export const SE_EARNINGS_FACTOR = 0.9235;
export const SE_MINIMUM = 400;
export const MA_INCOME_RATE = 0.05;
export const MA_SALES_TAX_RATE = 0.0625;

export interface SetAsideEstimate {
  netProfit: number;
  seTax: number;
  /** Half of SE tax — deductible before income tax. */
  seDeduction: number;
  taxableIncome: number;
  federalIncomeEst: number;
  maIncomeEst: number;
  totalSetAside: number;
  /** totalSetAside / netProfit (0 when there is no profit). */
  setAsideRate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estimateSetAside(netProfit: number, federalRate: number): SetAsideEstimate {
  const profit = Number.isFinite(netProfit) ? Math.max(0, netProfit) : 0;
  const seBase = profit * SE_EARNINGS_FACTOR;
  const seTax = seBase >= SE_MINIMUM ? seBase * SE_TAX_RATE : 0;
  const seDeduction = seTax / 2;
  const taxableIncome = Math.max(0, profit - seDeduction);
  const federalIncomeEst = taxableIncome * federalRate;
  const maIncomeEst = taxableIncome * MA_INCOME_RATE;
  const total = seTax + federalIncomeEst + maIncomeEst;
  return {
    netProfit: round2(profit),
    seTax: round2(seTax),
    seDeduction: round2(seDeduction),
    taxableIncome: round2(taxableIncome),
    federalIncomeEst: round2(federalIncomeEst),
    maIncomeEst: round2(maIncomeEst),
    totalSetAside: round2(total),
    setAsideRate: profit > 0 ? Math.round((total / profit) * 1000) / 1000 : 0,
  };
}

export function maSalesTax(directSales: number): number {
  if (!Number.isFinite(directSales) || directSales <= 0) return 0;
  return round2(directSales * MA_SALES_TAX_RATE);
}

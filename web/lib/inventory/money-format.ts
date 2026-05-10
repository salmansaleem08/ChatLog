/** Display-only formatting; amounts match DB numeric(14,4). */
export function formatMoneyAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

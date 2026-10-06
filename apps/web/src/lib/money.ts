/**
 * Converting between US dollars shown in forms and micro-USD integers used
 * by the API (see D-008 in docs/decisions.md).
 */
import { MICRO_USD_PER_USD } from '@agent-dashboard/shared';

/** Dollars with up to six decimal places, e.g. `2.5` or `0.000125`. */
const DOLLAR_AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const DISPLAY_FRACTION_DIGITS = 2;
const MAX_DISPLAY_FRACTION_DIGITS = 6;

/**
 * Formats micro-USD as a dollar string.
 *
 * @param microUsd - Integer micro-USD, or null for "no limit".
 * @returns e.g. `$2.50`, or `No limit` for null.
 */
export function formatMicroUsd(microUsd: number | null): string {
  if (microUsd === null) {
    return 'No limit';
  }
  return (microUsd / MICRO_USD_PER_USD).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: DISPLAY_FRACTION_DIGITS,
    maximumFractionDigits: MAX_DISPLAY_FRACTION_DIGITS,
  });
}

/**
 * Parses a dollar amount typed into a form.
 *
 * Works on the decimal string rather than multiplying a float, so `0.1`
 * becomes exactly 100000 micro-USD.
 *
 * @param dollarText - e.g. `2.5`; blank means "no limit".
 * @returns Micro-USD, null for blank input, or undefined if the text is not a valid amount.
 */
export function parseDollarsToMicroUsd(dollarText: string): number | null | undefined {
  const trimmedText = dollarText.trim();
  if (trimmedText === '') {
    return null;
  }
  if (!DOLLAR_AMOUNT_PATTERN.test(trimmedText)) {
    return undefined;
  }
  const [wholeDollars = '0', fraction = ''] = trimmedText.split('.');
  const paddedFraction = fraction.padEnd(MAX_DISPLAY_FRACTION_DIGITS, '0');
  return Number(wholeDollars) * MICRO_USD_PER_USD + Number(paddedFraction);
}

/**
 * Formats micro-USD as plain dollars for a form input.
 *
 * @param microUsd - Integer micro-USD, or null.
 * @returns e.g. `2.5`, or an empty string for null.
 */
export function microUsdToDollarInput(microUsd: number | null): string {
  return microUsd === null ? '' : String(microUsd / MICRO_USD_PER_USD);
}

const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

const US_STATE_CODE_SET = new Set<string>(US_STATE_CODES);

export const ALLOWED_REGION_IDS = new Set<string>([
  'US',
  ...US_STATE_CODES.map((state) => `US-${state}`),
]);

export function normalizeRegionCode(value: string) {
  return value.trim().toUpperCase();
}

export function isAllowedRegionId(id: string) {
  return ALLOWED_REGION_IDS.has(normalizeRegionCode(id));
}

export function isAllowedCountryAdmin1(country: string, admin1?: string | null) {
  const normalizedCountry = normalizeRegionCode(country);
  if (normalizedCountry !== 'US') return false;
  if (admin1 == null || admin1.trim() === '') return true;
  return US_STATE_CODE_SET.has(normalizeRegionCode(admin1));
}

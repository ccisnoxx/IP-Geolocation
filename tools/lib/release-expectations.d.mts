export function inferBakedFields(source: string): { timezone: string | null; locale: string | null };
export function headerLocaleFromRules(rules: unknown[] | null | undefined): string | null;
export function headerValueFromRules(rules: unknown[] | null | undefined): string | null;
export function ruleDomains(rules: unknown[] | null | undefined): string[];
export function inferBakedLanguages(source: string): string[] | null;
export function resolveExpectations(input?: { summary?: any; source?: string; rules?: unknown[] | null }): {
  expectTz: string | null;
  expectLocale: string | null;
  bakedLocale: string | null;
  headerLocale: string | null;
  bakedLanguages: string[] | null;
  headerValue: string | null;
  domains: string[];
};
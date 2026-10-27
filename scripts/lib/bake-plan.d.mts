export function resolveDomains(defaultDomains: string[], raw?: string): string[];
export function configFromPreset(preset: any, options: any): any;
export function configFromPersona(persona: any, options: any): any;
export function releaseFileName(input: { version: string; label?: string; frozen?: boolean }): string;
export function verifyBakedRuntime(source: string, expect: any): { ok: boolean; problems: string[] };

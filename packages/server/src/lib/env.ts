/**
 * Baked-at-package-time credentials. build.mjs injects a single JSON blob via
 * esbuild define on the STATIC reference below — esbuild's define cannot touch
 * dynamic `process.env[computed]` access, which is why per-key `<KEY>_BUILTIN`
 * defines silently never worked. In dev (tsx, no bundling) the define is absent
 * and this parses '{}' — .env/dotenv provides the values instead.
 */
const BUILTINS: Record<string, string | undefined> = JSON.parse(process.env.BUILTINS_JSON || '{}') as Record<string, string | undefined>;

/** Credential keys that carry a baked (non-empty) build-time value. */
export function builtinKeys(): string[] {
  return Object.keys(BUILTINS).filter((k) => BUILTINS[k]);
}

/** Resolve a credential/config value: runtime env (safeStorage-injected or
 *  .env in dev) first, then the build-time baked fallback.
 *  Returns '' when neither is set so callers can boolean-check availability. */
export function cred(key: string): string {
  return process.env[key] || BUILTINS[key] || '';
}

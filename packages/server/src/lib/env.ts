/** Resolve a credential/config value: runtime env (safeStorage-injected or
 *  .env in dev) first, then the build-time baked `<KEY>_BUILTIN` fallback.
 *  Returns '' when neither is set so callers can boolean-check availability. */
export function cred(key: string): string {
  return process.env[key] || process.env[`${key}_BUILTIN`] || '';
}

/** Keyed TTL cache — replaces the ad-hoc `Map<key, { data, expiresAt }>` idiom.
 *  For single-slot caching keep using SimpleCache. */
export class TtlCache<K, V> {
  private entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: K): V | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    // Delete-then-set keeps insertion order = recency, so the FIFO eviction
    // below drops the stalest key once the cap is hit.
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

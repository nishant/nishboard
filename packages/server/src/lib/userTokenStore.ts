import fs from 'fs';
import path from 'path';
import os from 'os';

/** Persisted OAuth user tokens (plain JSON under ~/.dash — home dir so they
 *  survive reinstalls; these are user-session tokens, not app secrets). */
export interface StoredUserTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  /** Service-specific extras persisted alongside the tokens (e.g. Twitch user_id). */
  meta?: Record<string, string>;
}

/**
 * File-backed user-token store with a single-flight refresh.
 *
 * Both Spotify and Twitch rotate refresh tokens: two concurrent refreshes race
 * to persist different token pairs, and last-write-wins can store a dead one
 * (forcing a re-auth). All concurrent callers therefore await the same refresh.
 *
 * A failed refresh clears the store — most often the token was minted under a
 * different client_id and will never work again; clearing flips auth-status to
 * disconnected so the widget shows "Connect" instead of looping errors.
 */
export class UserTokenStore {
  private tokens: StoredUserTokens | null;
  private refreshInFlight: Promise<StoredUserTokens> | null = null;
  private readonly file: string;

  constructor(
    filename: string,
    private readonly refreshFn: (refreshToken: string) => Promise<StoredUserTokens>,
    private readonly expirySkewMs = 60_000,
  ) {
    this.file = path.join(os.homedir(), '.dash', filename);
    this.tokens = this.load();
  }

  private load(): StoredUserTokens | null {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredUserTokens;
    } catch {
      return null;
    }
  }

  private save(t: StoredUserTokens): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(t), 'utf8');
  }

  get authenticated(): boolean {
    return this.tokens !== null;
  }

  get meta(): Record<string, string> | undefined {
    return this.tokens?.meta;
  }

  /** Persist a fresh token set (auth-code exchange just completed). */
  store(t: StoredUserTokens): void {
    this.tokens = t;
    this.save(t);
  }

  clear(): void {
    this.tokens = null;
    try { fs.unlinkSync(this.file); } catch { /* already gone */ }
  }

  /** A valid access token, refreshing (single-flight) when within the expiry skew. */
  async getValidToken(): Promise<string> {
    if (!this.tokens) throw new Error('Not authenticated');
    if (Date.now() > this.tokens.expires_at - this.expirySkewMs) {
      try {
        this.refreshInFlight ??= this.refreshFn(this.tokens.refresh_token).finally(() => {
          this.refreshInFlight = null;
        });
        const fresh = await this.refreshInFlight;
        // Refresh responses don't carry service meta — keep what we had.
        this.tokens = { ...fresh, meta: fresh.meta ?? this.tokens.meta };
        this.save(this.tokens);
      } catch (err) {
        this.clear();
        throw err;
      }
    }
    return this.tokens.access_token;
  }
}

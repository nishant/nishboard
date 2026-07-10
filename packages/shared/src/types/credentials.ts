export const CREDENTIAL_KEYS = [
  'SPOTIFY_CLIENT_ID',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'COINGECKO_API_KEY',
  'GITHUB_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

export type CredentialKey = typeof CREDENTIAL_KEYS[number];

export interface CredentialDef {
  key: CredentialKey;
  label: string;
  service: string;
  hint?: string;
}

export const CREDENTIAL_DEFS: CredentialDef[] = [
  {
    key: 'SPOTIFY_CLIENT_ID',
    label: 'Client ID',
    service: 'Spotify',
    hint: 'Create an app at developer.spotify.com → Dashboard. Set redirect URI to http://127.0.0.1:7432/api/spotify/callback',
  },
  { key: 'YOUTUBE_API_KEY',      label: 'API Key',       service: 'YouTube' },
  {
    key: 'YOUTUBE_CLIENT_ID',
    label: 'OAuth Client ID',
    service: 'YouTube',
    hint: 'Optional — enables the signed-in Subs/Playlists/Liked tabs and Google Calendar events in the Calendar widget. Google Cloud console → OAuth client (Web application) with redirect URIs http://localhost:7432/api/youtube/callback and http://localhost:7432/api/calendar/callback',
  },
  { key: 'YOUTUBE_CLIENT_SECRET', label: 'OAuth Client Secret', service: 'YouTube' },
  { key: 'ALPACA_API_KEY',       label: 'API Key',       service: 'Stocks (Alpaca)' },
  { key: 'ALPACA_API_SECRET',    label: 'API Secret',    service: 'Stocks (Alpaca)' },
  { key: 'TWITCH_CLIENT_ID',     label: 'Client ID',     service: 'Twitch' },
  { key: 'TWITCH_CLIENT_SECRET', label: 'Client Secret', service: 'Twitch' },
  {
    key: 'COINGECKO_API_KEY',
    label: 'API Key',
    service: 'Crypto (CoinGecko)',
    hint: 'Optional — works keyless but heavily rate-limited. Free demo key: coingecko.com → Developer Dashboard (30 req/min, 10k/month).',
  },
  {
    key: 'GITHUB_TOKEN',
    label: 'Token',
    service: 'Updates (GitHub)',
    hint: 'Optional — only needed for the update check while the repo is private. Fine-grained PAT with read-only Contents access.',
  },
  {
    // Deliberately NOT in build.mjs BUILTIN_KEYS — a personal Max-plan token
    // must never be baked into distributed installers.
    key: 'CLAUDE_CODE_OAUTH_TOKEN',
    label: 'Claude Code OAuth Token',
    service: 'Claude',
    hint: "Optional — only needed if Claude Code isn't logged in on this machine. Generate with `claude setup-token`.",
  },
];

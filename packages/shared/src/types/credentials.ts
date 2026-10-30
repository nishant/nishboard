export const CREDENTIAL_KEYS = [
  'SPOTIFY_CLIENT_ID',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
  'TRADING_API_URL',
  'TRADING_API_TOKEN',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'COINGECKO_API_KEY',
  'GITHUB_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'INBOX_PASSWORD',
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
  {
    // Deliberately NOT in build.mjs BUILTIN_KEYS (URL + token) — personal
    // tailnet endpoint and account token, never baked into installers.
    key: 'TRADING_API_URL',
    label: 'API URL',
    service: 'Stocks (Trading watchlist)',
    hint: 'Optional — defaults to https://trading.nish.software (tailnet). On the PC that runs trading, http://127.0.0.1:7433 also works. The Stocks widget reads its tickers and badges from here.',
  },
  {
    key: 'TRADING_API_TOKEN',
    label: 'Read-only API token',
    service: 'Stocks (Trading watchlist)',
    hint: 'trading → Settings → API Access → Generate Token (shown once, starts with otar_). Rotating it there kills the old one instantly — paste the new one here.',
  },
  { key: 'TWITCH_CLIENT_ID',     label: 'Client ID',     service: 'Twitch' },
  { key: 'TWITCH_CLIENT_SECRET', label: 'Client Secret', service: 'Twitch' },
  {
    key: 'DISCORD_CLIENT_ID',
    label: 'Client ID',
    service: 'Discord',
    hint: 'Only for the Discord widget’s native mode (local RPC to the desktop app). Create an application YOU own at discord.com/developers/applications (the owner account has RPC access without a tester allowlist) and add redirect http://localhost:7432/api/discord/callback.',
  },
  { key: 'DISCORD_CLIENT_SECRET', label: 'Client Secret', service: 'Discord' },
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
  {
    // Deliberately NOT in build.mjs BUILTIN_KEYS — a personal password.
    key: 'INBOX_PASSWORD',
    label: 'Password',
    service: 'Inbox',
    hint: 'The Inbox page password (the inbox service on the PC, 127.0.0.1:8805). Leave empty on the Mac.',
  },
];

export const CREDENTIAL_KEYS = [
  'SPOTIFY_CLIENT_ID',
  'YOUTUBE_API_KEY',
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
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
  { key: 'ALPACA_API_KEY',       label: 'API Key',       service: 'Stocks (Alpaca)' },
  { key: 'ALPACA_API_SECRET',    label: 'API Secret',    service: 'Stocks (Alpaca)' },
  { key: 'TWITCH_CLIENT_ID',     label: 'Client ID',     service: 'Twitch' },
  { key: 'TWITCH_CLIENT_SECRET', label: 'Client Secret', service: 'Twitch' },
];

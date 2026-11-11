import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsModal } from './SettingsModal';
import { useOverlayStore } from '../store/overlayStore';
import { apiClient } from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({ apiClient: { get: vi.fn() } }));

// The credentials bridge is the only part of window.electron these tests need;
// the other optional bridges (app, backup, prefs, restartServer) stay absent so
// their rows render nothing.
function stubElectron(credentials: {
  getStatus: () => Promise<Record<string, boolean>>;
  saveAll: (payload: Record<string, string>) => Promise<void>;
}) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { credentials: { encryptionAvailable: () => Promise.resolve(true), ...credentials } },
  });
}

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsModal onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useOverlayStore.setState({ settingsTab: 'dev' });
  vi.mocked(apiClient.get).mockResolvedValue({ keys: [] });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electron');
  vi.clearAllMocks();
});

describe('SettingsModal credentials', () => {
  it('saves only the typed key, trimmed', async () => {
    const saveAll = vi.fn(() => Promise.resolve());
    stubElectron({ getStatus: () => Promise.resolve({}), saveAll });
    const user = userEvent.setup();
    renderModal();

    // Spotify is the first service, so its Client ID row comes first.
    const [spotifyClientId] = await screen.findAllByLabelText('Client ID');
    expect(spotifyClientId).toBeDefined();
    if (!spotifyClientId) return;
    await user.type(spotifyClientId, '  abc123  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveAll).toHaveBeenCalledTimes(1));
    expect(saveAll).toHaveBeenCalledWith({ SPOTIFY_CLIENT_ID: 'abc123' });
  });

  it('keeps Save disabled while a save is in flight', async () => {
    let finish: () => void = () => {};
    const saveAll = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    stubElectron({ getStatus: () => Promise.resolve({}), saveAll });
    const user = userEvent.setup();
    renderModal();

    const [field] = await screen.findAllByLabelText('Client ID');
    if (!field) throw new Error('no Client ID field');
    await user.type(field, 'abc');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', false);
    await user.click(save);

    const saving = await screen.findByRole('button', { name: /saving/i });
    expect(saving).toHaveProperty('disabled', true);
    await user.click(saving);
    expect(saveAll).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(screen.queryByRole('button', { name: /saving/i })).toBeNull());
  });

  it('still shows which keys are saved when the builtin-key fetch rejects', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('server down'));
    stubElectron({
      getStatus: () => Promise.resolve({ SPOTIFY_CLIENT_ID: true }),
      saveAll: () => Promise.resolve(),
    });
    renderModal();

    expect(await screen.findByText(/Server unreachable/)).toBeTruthy();
    expect((await screen.findAllByText('saved')).length).toBeGreaterThan(0);
  });
});

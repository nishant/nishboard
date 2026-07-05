import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ElectronAPI, LauncherStateData } from '@dash/shared';
import { LauncherWidget } from './LauncherWidget';
import { useLauncherUiStore } from '../../store/launcherUiStore';

const STATE: LauncherStateData = {
  groups: [{ id: 'g1', label: 'Games' }],
  items: [
    { id: 'i1', label: 'Browser', kind: 'url', icon: 'data:image/png;base64,AAAA' },
    { id: 'i2', label: 'Steam', kind: 'app', group: 'g1' },
    { id: 'i3', label: 'Epic', kind: 'app', group: 'g1' },
  ],
};

const launch = vi.fn(async () => undefined);
const launchGroup = vi.fn(async () => undefined);

function mockElectron(state: LauncherStateData): void {
  // Only the surface LauncherWidget touches — everything else is absent, which
  // the component must tolerate (it optional-chains the bridge).
  const partial = {
    platform: 'win32',
    launcher: {
      getItems: async () => state,
      launch,
      launchGroup,
    },
  };
  Object.defineProperty(window, 'electron', {
    value: partial as unknown as ElectronAPI,
    configurable: true,
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  launch.mockClear();
  launchGroup.mockClear();
  useLauncherUiStore.setState({ editing: false, collapsed: {} });
  mockElectron(STATE);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'electron');
});

describe('LauncherWidget groups', () => {
  it('renders ungrouped items first, then each group with its member count', async () => {
    render(<LauncherWidget />);
    expect(await screen.findByText('Browser')).toBeTruthy();
    expect(screen.getByText('Games')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
    expect(screen.getByText('Steam')).toBeTruthy();
    expect(screen.getByText('Epic')).toBeTruthy();
    // data:-URI icon renders as an <img> — never a remote URL.
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('collapsing a group hides its members and persists in the UI store', async () => {
    const user = userEvent.setup();
    render(<LauncherWidget />);
    await screen.findByText('Games');

    await user.click(screen.getByTitle('Collapse'));
    expect(screen.queryByText('Steam')).toBeNull();
    expect(screen.queryByText('Epic')).toBeNull();
    expect(screen.getByText('Browser')).toBeTruthy(); // ungrouped unaffected
    expect(useLauncherUiStore.getState().collapsed['g1']).toBe(true);

    await user.click(screen.getByTitle('Expand'));
    expect(screen.getByText('Steam')).toBeTruthy();
  });

  it('launches items by id and groups via the header action — targets never cross the bridge', async () => {
    const user = userEvent.setup();
    render(<LauncherWidget />);
    await screen.findByText('Browser');

    await user.click(screen.getByTitle('Browser'));
    expect(launch).toHaveBeenCalledWith('i1');

    await user.click(screen.getByTitle('Launch all in Games'));
    expect(launchGroup).toHaveBeenCalledWith('g1');
  });

  it('shows the empty state outside Electron', () => {
    Reflect.deleteProperty(window, 'electron');
    render(<LauncherWidget />);
    expect(screen.getByText('Launcher works in the desktop app')).toBeTruthy();
  });
});

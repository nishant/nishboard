import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EmbedSearchWidget } from './EmbedSearchWidget';
import type { EmbedFolder, EmbedItem, EmbedServiceAdapter } from './types';

// The embed state machine with a fake adapter: folder Back pops one level, and
// opening search while a video plays keeps the iframe mounted.

const CHAN: EmbedFolder = { id: 'channel:c1', title: 'Chan' };
const ROOT: EmbedFolder = { id: 'f1', title: 'Folder One' };
const VIDEO: EmbedItem = {
  id: 'v1', title: 'Video A', subtitle: 'by Chan', thumbnailUrl: '', channel: { id: 'c1', title: 'Chan' },
};
const NONE = { items: undefined, isFetching: false, isError: false };

const adapter: EmbedServiceAdapter = {
  serviceName: 'Fake',
  Icon: () => <svg />,
  searchPlaceholder: 'Search fake',
  homeCta: 'Search videos',
  emptyHint: 'Search above',
  errorHint: 'Broken',
  thumbShape: 'wide',
  closeLabel: 'Close video',
  embedUrl: (item) => `https://example.test/embed/${item.id}`,
  useSearch: () => NONE,
  browse: {
    tabs: [{ id: 'lists', label: 'Lists', kind: 'folders' }],
    useBrowse: () => NONE,
    useFolders: () => ({ folders: [ROOT], isFetching: false, isError: false }),
    useFolderItems: (folder) => (folder ? { items: [VIDEO], isFetching: false, isError: false } : NONE),
  },
};

describe('EmbedSearchWidget', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Back pops one folder level at a time', () => {
    render(<EmbedSearchWidget adapter={adapter} />);
    fireEvent.click(screen.getByText(ROOT.title));
    // Inside the folder: the video row's channel button opens the channel on top.
    fireEvent.click(screen.getByRole('button', { name: `${CHAN.title} — videos` }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // Back from the channel lands on the first folder, not the root list.
    expect(screen.getByText(ROOT.title)).toBeTruthy();
    expect(screen.getByText(VIDEO.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText(VIDEO.title)).toBeNull();
    expect(screen.getByText(ROOT.title)).toBeTruthy();
  });

  it('keeps the player iframe mounted while searching', () => {
    render(<EmbedSearchWidget adapter={adapter} />);
    fireEvent.click(screen.getByText(ROOT.title));
    fireEvent.click(screen.getByText(VIDEO.title));
    const iframe = document.querySelector('iframe');
    expect(iframe?.getAttribute('title')).toBe(`Fake: ${VIDEO.title}`);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(document.querySelector('iframe')).toBe(iframe);
  });
});

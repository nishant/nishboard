import { describe, expect, it } from 'vitest';
import type { IpcMain, IpcMainEvent } from 'electron';
import { apiToken, registerApiTokenIpc } from './apiToken';

type Handler = (event: IpcMainEvent) => void;

function handler(): Handler {
  const registered: Handler[] = [];
  const ipcMain = { on: (_channel: string, h: Handler) => registered.push(h) };
  registerApiTokenIpc(ipcMain as unknown as IpcMain);
  return registered[0];
}

function ask(url: string, opts: { subframe?: boolean } = {}): unknown {
  const mainFrame = { url };
  const event = {
    sender: { mainFrame },
    senderFrame: opts.subframe ? { url } : mainFrame,
    returnValue: undefined as unknown,
  };
  handler()(event as unknown as IpcMainEvent);
  return event.returnValue;
}

describe('apiToken', () => {
  it('is random, long and stable for the launch', () => {
    expect(apiToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(apiToken()).toBe(apiToken());
  });

  it('is handed to the app:// renderer top frame only', () => {
    expect(ask('app://nishboard/index.html')).toBe(apiToken());
    expect(ask('app://nishboard/index.html?widget=claude')).toBe(apiToken());
    expect(ask('app://nishboard/index.html', { subframe: true })).toBe('');
    expect(ask('app://evil/index.html')).toBe('');
    expect(ask('https://www.youtube.com/embed/x')).toBe('');
    expect(ask('http://localhost:7432/api/youtube/embed?videoId=x')).toBe('');
    expect(ask('file:///C:/app/renderer/dist/index.html')).toBe('');
    // The Vite dev origin counts only under NODE_ENV=development.
    expect(ask('http://localhost:5173/')).toBe('');
  });
});

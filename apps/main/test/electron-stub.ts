// Vitest stand-in for the `electron` module (aliased in vitest.config.ts).
// Exports every name the main-process modules destructure at module scope;
// tests exercise pure logic only, so the members are inert placeholders.

export const app = {
  getPath: (_name: string): string => '/tmp/nishboard-test',
  getVersion: (): string => '0.0.0-test',
  getFileIcon: (): Promise<{ toDataURL: () => string }> =>
    Promise.resolve({ toDataURL: () => 'data:image/png;base64,' }),
  on: (_event: string, _cb: unknown): void => undefined,
};

export const dialog = {};
export const shell = {};
export const clipboard = {
  readText: (): Promise<string> => Promise.resolve(''),
  writeText: (_text: string): Promise<void> => Promise.resolve(),
};

export const desktopCapturer = {
  getSources: (): Promise<never[]> => Promise.resolve([]),
};

// One inert session serves defaultSession and every partition (discord.ts
// configures persist:discord at init; tests only exercise pure helpers).
const inertSession = {
  getUserAgent: (): string => 'test-agent',
  setUserAgent: (_ua: string): void => undefined,
  setPermissionRequestHandler: (_h: unknown): void => undefined,
  setPermissionCheckHandler: (_h: unknown): void => undefined,
  setDisplayMediaRequestHandler: (_h: unknown): void => undefined,
  clearStorageData: (): Promise<void> => Promise.resolve(),
  clearCache: (): Promise<void> => Promise.resolve(),
  webRequest: { onHeadersReceived: (_filter: unknown, _cb: unknown): void => undefined },
};

export const session = {
  defaultSession: inertSession,
  fromPartition: (_name: string): typeof inertSession => inertSession,
};

export const net = {
  fetch: (): Promise<never> => Promise.reject(new Error('net.fetch not stubbed')),
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8'),
  isAsyncEncryptionAvailable: (): Promise<boolean> => Promise.resolve(false),
  encryptStringAsync: (s: string): Promise<Buffer> => Promise.resolve(Buffer.from(s, 'utf8')),
  decryptStringAsync: (b: Buffer): Promise<string> => Promise.resolve(b.toString('utf8')),
};

const stubWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
export const screen = {
  getAllDisplays: (): { workArea: typeof stubWorkArea }[] => [{ workArea: stubWorkArea }],
  getPrimaryDisplay: (): { workArea: typeof stubWorkArea } => ({ workArea: stubWorkArea }),
  on: (_event: string, _cb: unknown): void => undefined,
};

export const globalShortcut = {
  register: (_accelerator: string, _cb: unknown): boolean => true,
  unregister: (_accelerator: string): void => undefined,
  unregisterAll: (): void => undefined,
};

export const ipcMain = {
  handle: (_channel: string, _cb: unknown): void => undefined,
  on: (_channel: string, _cb: unknown): void => undefined,
};

export const nativeImage = {
  createFromPath: (_p: string): { isEmpty: () => boolean } => ({ isEmpty: () => true }),
  createEmpty: (): { isEmpty: () => boolean } => ({ isEmpty: () => true }),
};

export const nativeTheme = {
  themeSource: 'system' as 'system' | 'light' | 'dark',
  shouldUseDarkColors: true,
  on: (_event: string, _cb: unknown): void => undefined,
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}
export class Notification {}
export class Tray {}
export class Menu {}

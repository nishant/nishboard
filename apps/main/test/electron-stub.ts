// Vitest stand-in for the `electron` module (aliased in vitest.config.ts).
// Exports every name the main-process modules destructure at module scope;
// tests exercise pure logic only, so the members are inert placeholders.

export const app = {
  getPath: (_name: string): string => '/tmp/nishboard-test',
  getVersion: (): string => '0.0.0-test',
  getFileIcon: (): Promise<{ toDataURL: () => string }> =>
    Promise.resolve({ toDataURL: () => 'data:image/png;base64,' }),
};

export const dialog = {};
export const shell = {};
export const clipboard = {};

export const net = {
  fetch: (): Promise<never> => Promise.reject(new Error('net.fetch not stubbed')),
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8'),
};

export class BrowserWindow {}
export class Notification {}
export class Tray {}
export class Menu {}

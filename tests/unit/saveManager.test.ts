import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveManager } from '../../src/runtime/SaveManager';

const KEY_PREFIX = 'gb-emu:sram:';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

describe('SaveManager', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads legacy v1 SRAM-only payloads', () => {
    const manager = new SaveManager();
    const hash = 'legacy';
    const ram = Uint8Array.from([0x01, 0x02, 0x7f, 0xff]);
    localStorage.setItem(KEY_PREFIX + hash, bytesToBase64(ram));

    const loaded = manager.load(hash);
    expect(loaded).not.toBeNull();
    expect(loaded?.mapperMeta).toBeNull();
    expect(Array.from(loaded?.ram ?? [])).toEqual(Array.from(ram));
  });

  it('round-trips v2 payloads with RAM and mapper metadata', () => {
    const manager = new SaveManager();
    const hash = 'v2';
    const ram = Uint8Array.from([0xab, 0xcd, 0xef]);
    const mapperMeta = {
      type: 'mbc3_rtc_v1',
      rtc: {
        seconds: 1,
        minutes: 2,
        hours: 3,
        days: 4,
        carry: false,
        halt: true,
        lastUnixSeconds: 1234,
      },
    };

    expect(manager.save(hash, ram, mapperMeta)).toBe(true);
    const raw = localStorage.getItem(KEY_PREFIX + hash);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}').version).toBe(2);

    const loaded = manager.load(hash);
    expect(Array.from(loaded?.ram ?? [])).toEqual(Array.from(ram));
    expect(loaded?.mapperMeta).toEqual(mapperMeta);
  });

  it('stores mapper metadata even when RAM is absent', () => {
    const manager = new SaveManager();
    const hash = 'meta-only';
    const mapperMeta = { type: 'mbc3_rtc_v1', rtc: { halt: true } };

    expect(manager.save(hash, null, mapperMeta)).toBe(true);
    const loaded = manager.load(hash);
    expect(loaded?.ram).toBeNull();
    expect(loaded?.mapperMeta).toEqual(mapperMeta);
  });
});

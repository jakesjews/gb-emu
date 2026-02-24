const KEY_PREFIX = 'gb-emu:sram:';
const SAVE_VERSION = 2;

interface SavePayloadV2 {
  version: number;
  ram_b64: string | null;
  mapper_meta: unknown;
}

export interface LoadedSaveData {
  ram: Uint8Array | null;
  mapperMeta: unknown;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export class SaveManager {
  public async romHash(rom: Uint8Array): Promise<string> {
    const copy = new Uint8Array(rom.byteLength);
    copy.set(rom);
    const digest = await crypto.subtle.digest('SHA-1', copy.buffer);
    const bytes = new Uint8Array(digest);
    return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  public load(hash: string): LoadedSaveData | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + hash);
      if (!raw) {
        return null;
      }

      const parsed = this.parseSave(raw);
      if (parsed) {
        return parsed;
      }

      // Legacy v1 payload: base64 SRAM only.
      return {
        ram: base64ToBytes(raw),
        mapperMeta: null,
      };
    } catch {
      return null;
    }
  }

  public save(hash: string, ram: Uint8Array | null, mapperMeta: unknown): boolean {
    try {
      const payload: SavePayloadV2 = {
        version: SAVE_VERSION,
        ram_b64: ram ? bytesToBase64(ram) : null,
        mapper_meta: mapperMeta ?? null,
      };

      localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private parseSave(raw: string): LoadedSaveData | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      !('ram_b64' in parsed) ||
      (parsed as SavePayloadV2).version !== SAVE_VERSION
    ) {
      return null;
    }

    const payload = parsed as SavePayloadV2;
    if (payload.ram_b64 !== null && typeof payload.ram_b64 !== 'string') {
      return null;
    }

    return {
      ram: payload.ram_b64 ? base64ToBytes(payload.ram_b64) : null,
      mapperMeta: payload.mapper_meta ?? null,
    };
  }
}

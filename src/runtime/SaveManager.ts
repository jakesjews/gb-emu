const KEY_PREFIX = 'gb-emu:sram:';

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

  public load(hash: string): Uint8Array | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + hash);
      if (!raw) {
        return null;
      }

      return base64ToBytes(raw);
    } catch {
      return null;
    }
  }

  public save(hash: string, data: Uint8Array): boolean {
    try {
      localStorage.setItem(KEY_PREFIX + hash, bytesToBase64(data));
      return true;
    } catch {
      return false;
    }
  }
}

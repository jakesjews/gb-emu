import type { Mapper } from '../Cartridge';

interface RtcState {
  seconds: number;
  minutes: number;
  hours: number;
  dayCounter: number;
  carry: boolean;
  halt: boolean;
  lastUnixSeconds: number;
}

interface MBC3RtcMetadata {
  type: 'mbc3_rtc_v1';
  rtc: {
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
    carry: boolean;
    halt: boolean;
    lastUnixSeconds: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toIntInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized < min || normalized > max) {
    return fallback;
  }

  return normalized;
}

export class MBC3Mapper implements Mapper {
  private readonly rom: Uint8Array;

  private readonly romBanks: number;

  private readonly ramBanks: number;

  private readonly ram: Uint8Array;

  private ramEnabled = false;

  private romBank = 1;

  private bankSelect = 0;

  private latchWrite = 0;

  private hasLatchedRtc = false;

  private readonly rtc: RtcState = {
    seconds: 0,
    minutes: 0,
    hours: 0,
    dayCounter: 0,
    carry: false,
    halt: false,
    lastUnixSeconds: 0,
  };

  private latchedRtc: RtcState = {
    seconds: 0,
    minutes: 0,
    hours: 0,
    dayCounter: 0,
    carry: false,
    halt: false,
    lastUnixSeconds: 0,
  };

  public dirtyRam = false;

  public constructor(rom: Uint8Array, ramSize: number) {
    this.rom = rom;
    this.romBanks = Math.max(2, rom.length / 0x4000);
    this.ramBanks = ramSize === 0 ? 0 : Math.max(1, ramSize / 0x2000);
    this.ram = new Uint8Array(ramSize);

    const now = this.hostSeconds();
    this.rtc.lastUnixSeconds = now;
    this.latchedRtc.lastUnixSeconds = now;
  }

  public readRom(address: number): number {
    if (address < 0x4000) {
      return this.rom[address] ?? 0xff;
    }

    const bank = this.romBank % this.romBanks;
    const bankOffset = bank * 0x4000;
    return this.rom[bankOffset + (address - 0x4000)] ?? 0xff;
  }

  public writeRom(address: number, value: number): void {
    const maskedValue = value & 0xff;

    if (address <= 0x1fff) {
      this.ramEnabled = (maskedValue & 0x0f) === 0x0a;
      return;
    }

    if (address <= 0x3fff) {
      const bank = maskedValue & 0x7f;
      this.romBank = bank === 0 ? 1 : bank;
      return;
    }

    if (address <= 0x5fff) {
      this.bankSelect = maskedValue & 0x0f;
      return;
    }

    const latchBit = maskedValue & 0x01;
    if (this.latchWrite === 0 && latchBit === 1) {
      this.latchClockData();
    }
    this.latchWrite = latchBit;
  }

  public readRam(address: number): number {
    if (!this.ramEnabled) {
      return 0xff;
    }

    if (this.bankSelect <= 0x03) {
      if (this.ram.length === 0) {
        return 0xff;
      }

      const bank = this.getRamBank();
      const offset = bank * 0x2000 + (address & 0x1fff);
      return this.ram[offset] ?? 0xff;
    }

    if (this.bankSelect >= 0x08 && this.bankSelect <= 0x0c) {
      return this.readRtcRegister(this.bankSelect);
    }

    return 0xff;
  }

  public writeRam(address: number, value: number): void {
    if (!this.ramEnabled) {
      return;
    }

    const maskedValue = value & 0xff;

    if (this.bankSelect <= 0x03) {
      if (this.ram.length === 0) {
        return;
      }

      const bank = this.getRamBank();
      const offset = bank * 0x2000 + (address & 0x1fff);
      this.ram[offset] = maskedValue;
      this.dirtyRam = true;
      return;
    }

    if (this.bankSelect >= 0x08 && this.bankSelect <= 0x0c) {
      this.writeRtcRegister(this.bankSelect, maskedValue);
    }
  }

  public getRam(): Uint8Array | null {
    if (this.ram.length === 0) {
      return null;
    }

    return this.ram;
  }

  public loadRam(data: Uint8Array): void {
    if (this.ram.length === 0) {
      return;
    }

    const length = Math.min(this.ram.length, data.length);
    this.ram.set(data.subarray(0, length), 0);
    this.dirtyRam = false;
  }

  public clearDirtyFlag(): void {
    this.dirtyRam = false;
  }

  public exportMetadata(): unknown {
    this.updateRtcFromHost();
    return {
      type: 'mbc3_rtc_v1',
      rtc: {
        seconds: this.rtc.seconds,
        minutes: this.rtc.minutes,
        hours: this.rtc.hours,
        days: this.rtc.dayCounter,
        carry: this.rtc.carry,
        halt: this.rtc.halt,
        lastUnixSeconds: this.rtc.lastUnixSeconds,
      },
    } satisfies MBC3RtcMetadata;
  }

  public importMetadata(metadata: unknown): void {
    if (!isRecord(metadata) || metadata.type !== 'mbc3_rtc_v1' || !isRecord(metadata.rtc)) {
      return;
    }

    const rtc = metadata.rtc;
    this.rtc.seconds = toIntInRange(rtc.seconds, 0, 59, this.rtc.seconds);
    this.rtc.minutes = toIntInRange(rtc.minutes, 0, 59, this.rtc.minutes);
    this.rtc.hours = toIntInRange(rtc.hours, 0, 23, this.rtc.hours);
    this.rtc.dayCounter = toIntInRange(rtc.days, 0, 0x1ff, this.rtc.dayCounter);
    this.rtc.carry = Boolean(rtc.carry);
    this.rtc.halt = Boolean(rtc.halt);
    this.rtc.lastUnixSeconds = toIntInRange(
      rtc.lastUnixSeconds,
      0,
      Number.MAX_SAFE_INTEGER,
      this.hostSeconds(),
    );

    this.latchedRtc = { ...this.rtc };
    this.hasLatchedRtc = false;
    this.latchWrite = 0;
    this.dirtyRam = false;
  }

  private getRamBank(): number {
    if (this.ramBanks <= 1) {
      return 0;
    }

    return (this.bankSelect & 0x03) % this.ramBanks;
  }

  private readRtcRegister(register: number): number {
    this.updateRtcFromHost();
    const source = this.hasLatchedRtc ? this.latchedRtc : this.rtc;

    switch (register & 0x0f) {
      case 0x08:
        return source.seconds & 0xff;
      case 0x09:
        return source.minutes & 0xff;
      case 0x0a:
        return source.hours & 0xff;
      case 0x0b:
        return source.dayCounter & 0xff;
      case 0x0c:
        return (
          ((source.dayCounter >> 8) & 0x01) |
          (source.halt ? 0x40 : 0x00) |
          (source.carry ? 0x80 : 0x00)
        );
      default:
        return 0xff;
    }
  }

  private writeRtcRegister(register: number, value: number): void {
    this.updateRtcFromHost();

    switch (register & 0x0f) {
      case 0x08:
        this.rtc.seconds = value % 60;
        break;
      case 0x09:
        this.rtc.minutes = value % 60;
        break;
      case 0x0a:
        this.rtc.hours = value % 24;
        break;
      case 0x0b:
        this.rtc.dayCounter = ((this.rtc.dayCounter & 0x100) | value) & 0x1ff;
        break;
      case 0x0c: {
        const previousHalt = this.rtc.halt;
        this.rtc.dayCounter = ((this.rtc.dayCounter & 0xff) | ((value & 0x01) << 8)) & 0x1ff;
        this.rtc.halt = (value & 0x40) !== 0;
        this.rtc.carry = (value & 0x80) !== 0;
        if (previousHalt !== this.rtc.halt) {
          this.rtc.lastUnixSeconds = this.hostSeconds();
        }
        break;
      }
      default:
        return;
    }

    this.dirtyRam = true;
  }

  private latchClockData(): void {
    this.updateRtcFromHost();
    this.latchedRtc = { ...this.rtc };
    this.hasLatchedRtc = true;
  }

  private updateRtcFromHost(): void {
    const now = this.hostSeconds();

    if (this.rtc.lastUnixSeconds <= 0) {
      this.rtc.lastUnixSeconds = now;
      return;
    }

    if (now <= this.rtc.lastUnixSeconds) {
      this.rtc.lastUnixSeconds = now;
      return;
    }

    const delta = now - this.rtc.lastUnixSeconds;
    this.rtc.lastUnixSeconds = now;

    if (this.rtc.halt || delta <= 0) {
      return;
    }

    this.advanceRtc(delta);
  }

  private advanceRtc(deltaSeconds: number): void {
    let daySeconds = this.rtc.seconds + this.rtc.minutes * 60 + this.rtc.hours * 3600;
    daySeconds += deltaSeconds;

    const dayAdvance = Math.floor(daySeconds / 86400);
    let secondsOfDay = daySeconds % 86400;
    if (secondsOfDay < 0) {
      secondsOfDay += 86400;
    }

    if (dayAdvance > 0) {
      const nextDays = this.rtc.dayCounter + dayAdvance;
      if (nextDays > 0x1ff) {
        this.rtc.carry = true;
      }
      this.rtc.dayCounter = nextDays & 0x1ff;
    }

    this.rtc.hours = Math.floor(secondsOfDay / 3600);
    secondsOfDay %= 3600;
    this.rtc.minutes = Math.floor(secondsOfDay / 60);
    this.rtc.seconds = secondsOfDay % 60;
  }

  private hostSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}

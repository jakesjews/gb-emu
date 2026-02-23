import { InterruptController, InterruptFlag } from '../interrupts/InterruptController';
import { renderScanline } from './renderer';

const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM = 2;
const MODE_TRANSFER = 3;

export class PPU {
  private readonly interrupts: InterruptController;

  private readonly vram = new Uint8Array(0x2000);

  private readonly oam = new Uint8Array(0x00a0);

  private readonly frameBuffer = new Uint32Array(160 * 144);

  private lcdc = 0x91;

  private stat = 0x85;

  private scy = 0;

  private scx = 0;

  private ly = 0;

  private lyc = 0;

  private dma = 0xff;

  private bgp = 0xfc;

  private obp0 = 0xff;

  private obp1 = 0xff;

  private wy = 0;

  private wx = 0;

  private modeClock = 0;

  private frameReady = false;

  private lastStatLine = false;

  public constructor(interrupts: InterruptController) {
    this.interrupts = interrupts;
  }

  public reset(): void {
    this.vram.fill(0);
    this.oam.fill(0);
    this.frameBuffer.fill(0xffffffff);
    this.lcdc = 0x91;
    this.stat = 0x85;
    this.scy = 0;
    this.scx = 0;
    this.ly = 0;
    this.lyc = 0;
    this.dma = 0xff;
    this.bgp = 0xfc;
    this.obp0 = 0xff;
    this.obp1 = 0xff;
    this.wy = 0;
    this.wx = 0;
    this.modeClock = 0;
    this.frameReady = false;
    this.lastStatLine = false;
    this.setMode(MODE_OAM);
  }

  public tick(cycles: number): void {
    if ((this.lcdc & 0x80) === 0) {
      return;
    }

    let remaining = cycles;
    while (remaining > 0) {
      const step = Math.min(remaining, 4);
      remaining -= step;
      this.modeClock += step;

      switch (this.getMode()) {
        case MODE_OAM:
          if (this.modeClock >= 80) {
            this.modeClock -= 80;
            this.setMode(MODE_TRANSFER);
          }
          break;

        case MODE_TRANSFER:
          if (this.modeClock >= 172) {
            this.modeClock -= 172;
            if (this.ly < 144) {
              this.renderCurrentLine();
            }

            this.setMode(MODE_HBLANK);
          }
          break;

        case MODE_HBLANK:
          if (this.modeClock >= 204) {
            this.modeClock -= 204;
            this.ly = (this.ly + 1) & 0xff;
            this.updateLycCoincidence();

            if (this.ly === 144) {
              this.setMode(MODE_VBLANK);
              this.interrupts.request(InterruptFlag.VBlank);
              this.frameReady = true;
            } else {
              this.setMode(MODE_OAM);
            }
          }
          break;

        case MODE_VBLANK:
          if (this.modeClock >= 456) {
            this.modeClock -= 456;
            this.ly += 1;
            this.updateLycCoincidence();

            if (this.ly > 153) {
              this.ly = 0;
              this.updateLycCoincidence();
              this.setMode(MODE_OAM);
            }
          }
          break;

        default:
          break;
      }

      this.updateStatInterrupt();
    }
  }

  public readVRAM(address: number): number {
    return this.vram[address & 0x1fff];
  }

  public writeVRAM(address: number, value: number): void {
    this.vram[address & 0x1fff] = value & 0xff;
  }

  public readOAM(address: number): number {
    return this.oam[address & 0x009f];
  }

  public writeOAM(address: number, value: number): void {
    this.oam[address & 0x009f] = value & 0xff;
  }

  public writeOamDirect(index: number, value: number): void {
    this.oam[index & 0x009f] = value & 0xff;
  }

  public readRegister(address: number): number {
    switch (address) {
      case 0xff40:
        return this.lcdc;
      case 0xff41:
        return this.stat | 0x80;
      case 0xff42:
        return this.scy;
      case 0xff43:
        return this.scx;
      case 0xff44:
        return this.ly;
      case 0xff45:
        return this.lyc;
      case 0xff46:
        return this.dma;
      case 0xff47:
        return this.bgp;
      case 0xff48:
        return this.obp0;
      case 0xff49:
        return this.obp1;
      case 0xff4a:
        return this.wy;
      case 0xff4b:
        return this.wx;
      default:
        return 0xff;
    }
  }

  public writeRegister(address: number, value: number): void {
    const masked = value & 0xff;

    switch (address) {
      case 0xff40:
        this.lcdc = masked;
        if ((masked & 0x80) === 0) {
          this.modeClock = 0;
          this.ly = 0;
          this.setMode(MODE_HBLANK);
          this.frameReady = true;
        } else if (this.getMode() === MODE_HBLANK && this.ly === 0) {
          this.setMode(MODE_OAM);
        }
        this.updateLycCoincidence();
        break;
      case 0xff41:
        this.stat = (this.stat & 0x07) | (masked & 0x78);
        this.updateStatInterrupt();
        break;
      case 0xff42:
        this.scy = masked;
        break;
      case 0xff43:
        this.scx = masked;
        break;
      case 0xff44:
        this.ly = 0;
        this.updateLycCoincidence();
        break;
      case 0xff45:
        this.lyc = masked;
        this.updateLycCoincidence();
        this.updateStatInterrupt();
        break;
      case 0xff46:
        this.dma = masked;
        break;
      case 0xff47:
        this.bgp = masked;
        break;
      case 0xff48:
        this.obp0 = masked;
        break;
      case 0xff49:
        this.obp1 = masked;
        break;
      case 0xff4a:
        this.wy = masked;
        break;
      case 0xff4b:
        this.wx = masked;
        break;
      default:
        break;
    }
  }

  public getDmaSourcePage(): number {
    return this.dma;
  }

  public consumeFrameReady(): boolean {
    if (!this.frameReady) {
      return false;
    }

    this.frameReady = false;
    return true;
  }

  public getFrameBuffer(): Uint32Array {
    return this.frameBuffer;
  }

  public getLY(): number {
    return this.ly;
  }

  public getLCDC(): number {
    return this.lcdc;
  }

  public getSTAT(): number {
    return this.stat;
  }

  private renderCurrentLine(): void {
    renderScanline(this.frameBuffer, this.vram, this.oam, {
      lcdc: this.lcdc,
      scx: this.scx,
      scy: this.scy,
      wy: this.wy,
      wx: this.wx,
      bgp: this.bgp,
      obp0: this.obp0,
      obp1: this.obp1,
    }, this.ly);
  }

  private getMode(): number {
    return this.stat & 0x03;
  }

  private setMode(mode: number): void {
    this.stat = (this.stat & ~0x03) | (mode & 0x03);
  }

  private updateLycCoincidence(): void {
    if (this.ly === this.lyc) {
      this.stat |= 0x04;
    } else {
      this.stat &= ~0x04;
    }
  }

  private updateStatInterrupt(): void {
    const mode = this.getMode();
    const lycInterrupt = (this.stat & 0x40) !== 0 && (this.stat & 0x04) !== 0;
    const oamInterrupt = (this.stat & 0x20) !== 0 && mode === MODE_OAM;
    const vblankInterrupt = (this.stat & 0x10) !== 0 && mode === MODE_VBLANK;
    const hblankInterrupt = (this.stat & 0x08) !== 0 && mode === MODE_HBLANK;

    const line = lycInterrupt || oamInterrupt || vblankInterrupt || hblankInterrupt;
    if (line && !this.lastStatLine) {
      this.interrupts.request(InterruptFlag.LCDStat);
    }

    this.lastStatLine = line;
  }
}

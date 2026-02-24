const DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112] as const;
const MAX_LENGTH = 64;

export class NoiseChannel {
  private nr41 = 0;

  private nr42 = 0;

  private nr43 = 0;

  private nr44 = 0;

  private enabled = false;

  private dacEnabled = false;

  private lengthCounter = 0;

  private volume = 0;

  private envelopeTimer = 0;

  private lfsr = 0x7fff;

  private frequencyTimer = 8;

  public reset(): void {
    this.nr41 = 0;
    this.nr42 = 0;
    this.nr43 = 0;
    this.nr44 = 0;
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.volume = 0;
    this.envelopeTimer = 0;
    this.lfsr = 0x7fff;
    this.frequencyTimer = 8;
  }

  public writeRegister(offset: number, value: number): void {
    const masked = value & 0xff;
    switch (offset) {
      case 0:
        this.nr41 = masked;
        this.lengthCounter = MAX_LENGTH - (masked & 0x3f);
        break;
      case 1:
        this.nr42 = masked;
        this.dacEnabled = (masked & 0xf8) !== 0;
        if (!this.dacEnabled) {
          this.enabled = false;
        }
        break;
      case 2:
        this.nr43 = masked;
        break;
      case 3:
        this.nr44 = masked;
        if ((masked & 0x80) !== 0) {
          this.trigger();
        }
        break;
      default:
        break;
    }
  }

  public readRegister(offset: number): number {
    switch (offset) {
      case 0:
        return this.nr41;
      case 1:
        return this.nr42;
      case 2:
        return this.nr43;
      case 3:
        return this.nr44;
      default:
        return 0xff;
    }
  }

  public tick(cycles: number): void {
    if (!this.enabled || cycles <= 0) {
      return;
    }

    this.frequencyTimer -= cycles;
    while (this.frequencyTimer <= 0) {
      this.frequencyTimer += this.frequencyPeriod();
      this.clockLfsr();
    }
  }

  public clockLength(): void {
    if ((this.nr44 & 0x40) === 0 || this.lengthCounter <= 0) {
      return;
    }

    this.lengthCounter -= 1;
    if (this.lengthCounter === 0) {
      this.enabled = false;
    }
  }

  public clockEnvelope(): void {
    const period = this.nr42 & 0x07;
    if (period === 0) {
      return;
    }

    if (this.envelopeTimer > 0) {
      this.envelopeTimer -= 1;
    }

    if (this.envelopeTimer > 0) {
      return;
    }

    this.envelopeTimer = period;
    const directionUp = (this.nr42 & 0x08) !== 0;
    if (directionUp && this.volume < 15) {
      this.volume += 1;
    } else if (!directionUp && this.volume > 0) {
      this.volume -= 1;
    }
  }

  public output(): number {
    if (!this.enabled || !this.dacEnabled || this.volume === 0) {
      return 0;
    }

    const bit = ~this.lfsr & 0x01;
    const polarity = bit === 0 ? -1 : 1;
    return (polarity * this.volume) / 15;
  }

  public isEnabled(): boolean {
    return this.enabled && this.dacEnabled;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getLfsr(): number {
    return this.lfsr & 0x7fff;
  }

  private trigger(): void {
    if (this.lengthCounter === 0) {
      this.lengthCounter = MAX_LENGTH;
    }

    this.enabled = this.dacEnabled;
    this.volume = (this.nr42 >> 4) & 0x0f;
    this.envelopeTimer = this.envelopePeriod();
    this.lfsr = 0x7fff;
    this.frequencyTimer = this.frequencyPeriod();
  }

  private envelopePeriod(): number {
    const period = this.nr42 & 0x07;
    return period === 0 ? 8 : period;
  }

  private frequencyPeriod(): number {
    const shift = (this.nr43 >> 4) & 0x0f;
    const divisor = DIVISORS[this.nr43 & 0x07];
    const period = divisor << shift;
    return Math.max(8, period);
  }

  private clockLfsr(): void {
    const xor = (this.lfsr & 0x01) ^ ((this.lfsr >> 1) & 0x01);
    this.lfsr = (this.lfsr >> 1) | (xor << 14);

    if ((this.nr43 & 0x08) !== 0) {
      this.lfsr = (this.lfsr & ~(1 << 6)) | (xor << 6);
    }
  }
}

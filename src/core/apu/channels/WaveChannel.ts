const MAX_LENGTH = 256;

export class WaveChannel {
  private nr30 = 0;

  private nr31 = 0;

  private nr32 = 0;

  private nr33 = 0;

  private nr34 = 0;

  private enabled = false;

  private dacEnabled = false;

  private lengthCounter = 0;

  private frequency = 0;

  private frequencyTimer = 2;

  private sampleIndex = 0;

  private readonly waveRam: Uint8Array;

  public constructor(waveRam: Uint8Array) {
    this.waveRam = waveRam;
  }

  public reset(): void {
    this.nr30 = 0;
    this.nr31 = 0;
    this.nr32 = 0;
    this.nr33 = 0;
    this.nr34 = 0;
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.frequency = 0;
    this.frequencyTimer = 2;
    this.sampleIndex = 0;
    this.waveRam.fill(0);
  }

  public writeRegister(offset: number, value: number): void {
    const masked = value & 0xff;
    switch (offset) {
      case 0:
        this.nr30 = masked;
        this.dacEnabled = (masked & 0x80) !== 0;
        if (!this.dacEnabled) {
          this.enabled = false;
        }
        break;
      case 1:
        this.nr31 = masked;
        this.lengthCounter = MAX_LENGTH - this.nr31;
        break;
      case 2:
        this.nr32 = masked;
        break;
      case 3:
        this.nr33 = masked;
        this.frequency = (this.frequency & 0x0700) | this.nr33;
        break;
      case 4:
        this.nr34 = masked;
        this.frequency = ((this.nr34 & 0x07) << 8) | this.nr33;
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
        return this.nr30;
      case 1:
        return this.nr31;
      case 2:
        return this.nr32;
      case 3:
        return this.nr33;
      case 4:
        return this.nr34;
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
      this.sampleIndex = (this.sampleIndex + 1) & 0x1f;
    }
  }

  public clockLength(): void {
    if ((this.nr34 & 0x40) === 0 || this.lengthCounter <= 0) {
      return;
    }

    this.lengthCounter -= 1;
    if (this.lengthCounter === 0) {
      this.enabled = false;
    }
  }

  public output(): number {
    if (!this.enabled || !this.dacEnabled) {
      return 0;
    }

    const byte = this.waveRam[this.sampleIndex >> 1];
    const raw = (this.sampleIndex & 1) === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;

    let sample = raw;
    const volumeCode = (this.nr32 >> 5) & 0x03;
    if (volumeCode === 0) {
      sample = 0;
    } else if (volumeCode === 2) {
      sample >>= 1;
    } else if (volumeCode === 3) {
      sample >>= 2;
    }

    return sample / 7.5 - 1;
  }

  public isEnabled(): boolean {
    return this.enabled && this.dacEnabled;
  }

  public getFrequency(): number {
    return this.frequency & 0x07ff;
  }

  private trigger(): void {
    if (this.lengthCounter === 0) {
      this.lengthCounter = MAX_LENGTH;
    }

    this.enabled = this.dacEnabled;
    this.frequencyTimer = this.frequencyPeriod();
    this.sampleIndex = 0;
  }

  private frequencyPeriod(): number {
    const period = (2048 - (this.frequency & 0x07ff)) * 2;
    return Math.max(2, period);
  }
}

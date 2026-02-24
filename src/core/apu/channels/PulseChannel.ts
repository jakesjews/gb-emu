const DUTY_PATTERNS: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

const MAX_LENGTH = 64;

export class PulseChannel {
  private readonly withSweep: boolean;

  private nrx0 = 0;

  private nrx1 = 0;

  private nrx2 = 0;

  private nrx3 = 0;

  private nrx4 = 0;

  private enabled = false;

  private dacEnabled = false;

  private lengthCounter = 0;

  private frequency = 0;

  private frequencyTimer = 8;

  private dutyStep = 0;

  private currentVolume = 0;

  private envelopeTimer = 0;

  private sweepTimer = 0;

  private sweepEnabled = false;

  private sweepNegateUsed = false;

  private sweepShadowFrequency = 0;

  public constructor(withSweep: boolean) {
    this.withSweep = withSweep;
  }

  public reset(): void {
    this.nrx0 = 0;
    this.nrx1 = 0;
    this.nrx2 = 0;
    this.nrx3 = 0;
    this.nrx4 = 0;
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.frequency = 0;
    this.frequencyTimer = 8;
    this.dutyStep = 0;
    this.currentVolume = 0;
    this.envelopeTimer = 0;
    this.sweepTimer = 0;
    this.sweepEnabled = false;
    this.sweepNegateUsed = false;
    this.sweepShadowFrequency = 0;
  }

  public writeRegister(offset: number, value: number): void {
    const masked = value & 0xff;

    switch (offset) {
      case 0:
        if (this.withSweep) {
          this.nrx0 = masked;
          if ((masked & 0x08) === 0 && this.sweepNegateUsed) {
            this.enabled = false;
          }
        }
        break;
      case 1:
        this.nrx1 = masked;
        this.lengthCounter = MAX_LENGTH - (masked & 0x3f);
        break;
      case 2:
        this.nrx2 = masked;
        this.dacEnabled = (masked & 0xf8) !== 0;
        if (!this.dacEnabled) {
          this.enabled = false;
        }
        break;
      case 3:
        this.nrx3 = masked;
        this.frequency = (this.frequency & 0x0700) | this.nrx3;
        break;
      case 4:
        this.nrx4 = masked;
        this.frequency = ((this.nrx4 & 0x07) << 8) | this.nrx3;
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
        return this.withSweep ? this.nrx0 : 0;
      case 1:
        return this.nrx1;
      case 2:
        return this.nrx2;
      case 3:
        return this.nrx3;
      case 4:
        return this.nrx4;
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
      this.dutyStep = (this.dutyStep + 1) & 0x07;
    }
  }

  public clockLength(): void {
    if ((this.nrx4 & 0x40) === 0 || this.lengthCounter <= 0) {
      return;
    }

    this.lengthCounter -= 1;
    if (this.lengthCounter === 0) {
      this.enabled = false;
    }
  }

  public clockEnvelope(): void {
    const period = this.nrx2 & 0x07;
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
    const directionUp = (this.nrx2 & 0x08) !== 0;
    if (directionUp && this.currentVolume < 15) {
      this.currentVolume += 1;
    } else if (!directionUp && this.currentVolume > 0) {
      this.currentVolume -= 1;
    }
  }

  public clockSweep(): void {
    if (!this.withSweep) {
      return;
    }

    if (this.sweepTimer > 0) {
      this.sweepTimer -= 1;
    }

    if (this.sweepTimer > 0) {
      return;
    }

    const period = this.sweepPeriod();
    this.sweepTimer = period === 0 ? 8 : period;

    if (!this.sweepEnabled || period === 0) {
      return;
    }

    const next = this.computeSweepFrequency();
    if (next > 2047) {
      this.enabled = false;
      return;
    }

    const shift = this.nrx0 & 0x07;
    if (shift === 0) {
      return;
    }

    this.sweepShadowFrequency = next;
    this.frequency = next;
    this.nrx3 = next & 0xff;
    this.nrx4 = (this.nrx4 & 0xf8) | ((next >> 8) & 0x07);

    if (this.computeSweepFrequency() > 2047) {
      this.enabled = false;
    }
  }

  public output(): number {
    if (!this.enabled || !this.dacEnabled || this.currentVolume === 0) {
      return 0;
    }

    const dutyPattern = DUTY_PATTERNS[(this.nrx1 >> 6) & 0x03];
    const high = dutyPattern[this.dutyStep] === 1;
    const polarity = high ? 1 : -1;
    return (polarity * this.currentVolume) / 15;
  }

  public isEnabled(): boolean {
    return this.enabled && this.dacEnabled;
  }

  public getFrequency(): number {
    return this.frequency & 0x07ff;
  }

  public getCurrentVolume(): number {
    return this.currentVolume;
  }

  private trigger(): void {
    if (this.lengthCounter === 0) {
      this.lengthCounter = MAX_LENGTH;
    }

    this.frequencyTimer = this.frequencyPeriod();
    this.dutyStep = 0;
    this.currentVolume = (this.nrx2 >> 4) & 0x0f;
    this.envelopeTimer = this.envelopePeriod();

    this.enabled = this.dacEnabled;

    if (!this.withSweep) {
      return;
    }

    this.sweepShadowFrequency = this.frequency;
    this.sweepTimer = this.sweepPeriod();
    this.sweepEnabled = this.sweepPeriod() > 0 || (this.nrx0 & 0x07) > 0;
    this.sweepNegateUsed = false;

    if ((this.nrx0 & 0x07) > 0 && this.computeSweepFrequency() > 2047) {
      this.enabled = false;
    }
  }

  private frequencyPeriod(): number {
    const period = (2048 - (this.frequency & 0x07ff)) * 4;
    return Math.max(4, period);
  }

  private envelopePeriod(): number {
    const period = this.nrx2 & 0x07;
    return period === 0 ? 8 : period;
  }

  private sweepPeriod(): number {
    const period = (this.nrx0 >> 4) & 0x07;
    return period === 0 ? 8 : period;
  }

  private computeSweepFrequency(): number {
    const shift = this.nrx0 & 0x07;
    if (shift === 0) {
      return this.sweepShadowFrequency;
    }

    const delta = this.sweepShadowFrequency >> shift;
    if ((this.nrx0 & 0x08) !== 0) {
      this.sweepNegateUsed = true;
      return this.sweepShadowFrequency - delta;
    }

    return this.sweepShadowFrequency + delta;
  }
}

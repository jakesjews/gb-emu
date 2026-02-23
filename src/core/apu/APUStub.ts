export class APUStub {
  private readonly registers = new Uint8Array(0x30);

  public reset(): void {
    this.registers.fill(0);
  }

  public tick(_cycles: number): void {
    // Audio is intentionally deferred in V1.
  }

  public read(address: number): number {
    const index = address - 0xff10;
    if (index < 0 || index >= this.registers.length) {
      return 0xff;
    }

    return this.registers[index];
  }

  public write(address: number, value: number): void {
    const index = address - 0xff10;
    if (index < 0 || index >= this.registers.length) {
      return;
    }

    this.registers[index] = value & 0xff;
  }

  public enableSound(): void {
    // Placeholder API for compatibility with future APU implementation.
  }
}

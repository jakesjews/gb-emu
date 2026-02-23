export class MMU {
  public readonly wram = new Uint8Array(0x2000);

  public readonly hram = new Uint8Array(0x007f);

  public reset(): void {
    this.wram.fill(0);
    this.hram.fill(0);
  }
}

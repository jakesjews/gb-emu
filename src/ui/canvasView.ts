export class CanvasView {
  private readonly canvas: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;

  private readonly imageData: ImageData;

  private readonly data: Uint8ClampedArray;

  public constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 144;
    this.canvas.className = 'gb-screen';
    parent.append(this.canvas);

    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    this.context = context;
    this.imageData = context.createImageData(160, 144);
    this.data = this.imageData.data;
  }

  public draw(frameBuffer: Uint32Array): void {
    for (let i = 0; i < frameBuffer.length; i += 1) {
      const color = frameBuffer[i];
      const pixel = i * 4;
      this.data[pixel] = (color >> 16) & 0xff;
      this.data[pixel + 1] = (color >> 8) & 0xff;
      this.data[pixel + 2] = color & 0xff;
      this.data[pixel + 3] = (color >> 24) & 0xff;
    }

    this.context.putImageData(this.imageData, 0, 0);
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}

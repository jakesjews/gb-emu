import { GameBoy } from '../core/system/GameBoy';

const CYCLES_PER_MS = 4_194_304 / 1000;

export interface LoopStats {
  fps: number;
  frameCount: number;
}

export class EmulatorLoop {
  private readonly gameBoy: GameBoy;

  private readonly pollInput: () => void;

  private readonly onStats: (stats: LoopStats) => void;

  private running = false;

  private lastTimestamp = 0;

  private cycleAccumulator = 0;

  private rafId: number | null = null;

  private statsFrameCount = 0;

  private totalFrameCount = 0;

  private lastStatsTimestamp = 0;

  private fps = 0;

  public constructor(gameBoy: GameBoy, pollInput: () => void, onStats: (stats: LoopStats) => void) {
    this.gameBoy = gameBoy;
    this.pollInput = pollInput;
    this.onStats = onStats;

    this.gameBoy.onFrameFinished(() => {
      this.statsFrameCount += 1;
      this.totalFrameCount += 1;
    });
  }

  public isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.gameBoy.start();
    this.lastTimestamp = 0;
    this.lastStatsTimestamp = 0;
    this.scheduleNextFrame();
  }

  public pause(): void {
    this.running = false;
    this.gameBoy.pause();

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public toggle(): void {
    if (this.running) {
      this.pause();
      return;
    }

    this.start();
  }

  public reset(): void {
    this.pause();
    this.cycleAccumulator = 0;
    this.statsFrameCount = 0;
    this.totalFrameCount = 0;
    this.fps = 0;
    this.onStats({ fps: this.fps, frameCount: this.totalFrameCount });
  }

  public stepInstruction(): void {
    this.gameBoy.stepInstruction();
    this.onStats({ fps: this.fps, frameCount: this.totalFrameCount });
  }

  public stepFrame(): void {
    this.gameBoy.stepFrame();
    this.onStats({ fps: this.fps, frameCount: this.totalFrameCount });
  }

  public advanceTime(ms: number): void {
    if (ms <= 0) {
      return;
    }

    const cycles = Math.floor(ms * CYCLES_PER_MS);
    this.pollInput();
    this.gameBoy.runForCycles(cycles);
    this.onStats({ fps: this.fps, frameCount: this.totalFrameCount });
  }

  private scheduleNextFrame(): void {
    this.rafId = requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private tick(timestamp: number): void {
    if (!this.running) {
      return;
    }

    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
      this.lastStatsTimestamp = timestamp;
    }

    const deltaMs = Math.min(50, Math.max(0, timestamp - this.lastTimestamp));
    this.lastTimestamp = timestamp;

    this.cycleAccumulator += deltaMs * CYCLES_PER_MS;
    const runCycles = Math.floor(this.cycleAccumulator);
    this.cycleAccumulator -= runCycles;

    this.pollInput();
    if (runCycles > 0) {
      this.gameBoy.runForCycles(runCycles);
    }

    const elapsedStats = timestamp - this.lastStatsTimestamp;
    if (elapsedStats >= 1000) {
      this.fps = (this.statsFrameCount * 1000) / elapsedStats;
      this.statsFrameCount = 0;
      this.lastStatsTimestamp = timestamp;
      this.onStats({ fps: this.fps, frameCount: this.totalFrameCount });
    }

    this.scheduleNextFrame();
  }
}

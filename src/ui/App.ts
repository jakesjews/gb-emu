import { GameBoy } from '../core/system/GameBoy';
import { EmulatorLoop } from '../runtime/EmulatorLoop';
import { GamepadManager } from '../runtime/GamepadManager';
import { SaveManager } from '../runtime/SaveManager';
import type { Button, EmulatorStatus } from '../types/emulator';
import { CanvasView } from './canvasView';
import { Controls } from './controls';
import { DebugPane } from './debugPane';
import './styles.css';

const KEY_TO_BUTTON: Record<string, Button> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
};

function toggleFullscreen(element: HTMLElement): void {
  if (!document.fullscreenElement) {
    void element.requestFullscreen();
    return;
  }

  void document.exitFullscreen();
}

function hashFrame(frame: Uint32Array): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < frame.length; i += 1) {
    hash ^= frame[i] >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash >>> 0;
}

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
  }
}

export class App {
  private readonly gameBoy = new GameBoy();

  private readonly saveManager = new SaveManager();

  private readonly canvasView: CanvasView;

  private readonly controls: Controls;

  private readonly debugPane: DebugPane;

  private readonly gamepadManager: GamepadManager;

  private readonly loop: EmulatorLoop;

  private romHash: string | null = null;

  private saveDebounceId: number | null = null;

  private readonly status: EmulatorStatus = {
    running: false,
    fps: 0,
    frameCount: 0,
    romName: null,
    saveState: 'idle',
  };

  public constructor(root: HTMLElement) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const screenCard = document.createElement('section');
    screenCard.className = 'screen-card';

    root.append(sidebar, screenCard);

    this.canvasView = new CanvasView(screenCard);
    this.debugPane = new DebugPane(sidebar);

    this.controls = new Controls(sidebar, {
      onSelectRom: async (file) => this.handleRomSelect(file),
      onToggleRun: () => this.toggleRun(),
      onReset: () => this.reset(),
      onStepInstruction: () => this.stepInstruction(),
      onStepFrame: () => this.stepFrame(),
    });

    this.controls.setRunning(false);

    this.gamepadManager = new GamepadManager((button, pressed) => {
      this.gameBoy.setButtonState(button, pressed);
    });

    this.loop = new EmulatorLoop(
      this.gameBoy,
      () => this.gamepadManager.poll(),
      (stats) => {
        this.status.fps = stats.fps;
        this.status.frameCount = stats.frameCount;
        this.controls.setFps(stats.fps, stats.frameCount);
      },
    );

    this.gameBoy.onFrameFinished((frame) => {
      this.canvasView.draw(frame);
      this.updateDebugPane();
      this.persistSaveIfDirty();
    });

    this.canvasView.draw(this.gameBoy.getFrameBuffer());
    this.updateDebugPane();
    this.installInputHandlers();
    this.installBrowserHooks();
  }

  private installInputHandlers(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF') {
        toggleFullscreen(this.canvasView.getCanvas());
        event.preventDefault();
        return;
      }

      const button = KEY_TO_BUTTON[event.code];
      if (!button) {
        return;
      }

      this.gameBoy.setButtonState(button, true);
      event.preventDefault();
    });

    window.addEventListener('keyup', (event) => {
      const button = KEY_TO_BUTTON[event.code];
      if (!button) {
        return;
      }

      this.gameBoy.setButtonState(button, false);
      event.preventDefault();
    });

    window.addEventListener('blur', () => {
      this.gameBoy.releaseAllButtons();
    });

    window.addEventListener('pagehide', () => {
      this.flushSave();
      this.gameBoy.releaseAllButtons();
    });

    window.addEventListener('beforeunload', () => {
      this.flushSave();
    });
  }

  private installBrowserHooks(): void {
    window.render_game_to_text = () => {
      const snapshot = this.gameBoy.getDebugSnapshot();
      const payload = {
        coordinate_system:
          'Screen origin is top-left at (0,0), +x right, +y down, resolution 160x144.',
        mode: this.loop.isRunning() ? 'running' : 'paused',
        rom: this.status.romName,
        frame_count: this.status.frameCount,
        fps: Number(this.status.fps.toFixed(2)),
        cpu: {
          pc: snapshot.pc,
          sp: snapshot.sp,
          af: snapshot.af,
          bc: snapshot.bc,
          de: snapshot.de,
          hl: snapshot.hl,
          ime: snapshot.ime,
          halted: snapshot.halted,
          opcode: snapshot.opcode,
          cycles: snapshot.cycles,
        },
        ppu: {
          ly: snapshot.ly,
          lcdc: snapshot.lcdc,
          stat: snapshot.stat,
        },
        interrupts: {
          ie: snapshot.ie,
          if: snapshot.if,
        },
        frame_hash: hashFrame(this.gameBoy.getFrameBuffer()),
        compat_flags: this.gameBoy.getCompatFlags(),
        joypad: this.gameBoy.getJoypadDebug(),
        serial_tail: this.gameBoy.getSerialOutput().slice(-120),
      };

      return JSON.stringify(payload);
    };

    window.advanceTime = (ms: number) => {
      this.loop.advanceTime(ms);
      this.updateDebugPane();
    };
  }

  private async handleRomSelect(file: File): Promise<void> {
    this.controls.setError('');

    try {
      const romBuffer = await file.arrayBuffer();
      await this.gameBoy.loadRom(romBuffer);

      this.romHash = await this.saveManager.romHash(new Uint8Array(romBuffer));
      const existingSave = this.saveManager.load(this.romHash);
      if (existingSave) {
        if (existingSave.ram) {
          this.gameBoy.importSaveRam(existingSave.ram);
        }
        if (existingSave.mapperMeta !== null) {
          this.gameBoy.importSaveMetadata(existingSave.mapperMeta);
        }
        this.status.saveState = 'saved';
      } else {
        this.status.saveState = 'idle';
      }

      const cartridgeInfo = this.gameBoy.getCartridgeInfo();
      this.status.romName = cartridgeInfo?.title || file.name;
      this.controls.setRomName(this.status.romName);
      this.controls.setSaveState(this.status.saveState);

      this.loop.reset();
      this.status.running = false;
      this.controls.setRunning(false);
      this.canvasView.draw(this.gameBoy.getFrameBuffer());
      this.updateDebugPane();
    } catch (error) {
      this.controls.setError(error instanceof Error ? error.message : 'Unable to load ROM.');
      this.status.romName = null;
      this.controls.setRomName(null);
    }
  }

  private toggleRun(): void {
    if (!this.status.romName) {
      this.controls.setError('Load a ROM before starting emulation.');
      return;
    }

    this.controls.setError('');
    this.loop.toggle();
    this.status.running = this.loop.isRunning();
    this.controls.setRunning(this.status.running);
  }

  private reset(): void {
    if (!this.status.romName) {
      return;
    }

    this.loop.reset();
    this.gameBoy.reset();

    if (this.romHash) {
      const existingSave = this.saveManager.load(this.romHash);
      if (existingSave) {
        if (existingSave.ram) {
          this.gameBoy.importSaveRam(existingSave.ram);
        }
        if (existingSave.mapperMeta !== null) {
          this.gameBoy.importSaveMetadata(existingSave.mapperMeta);
        }
      }
    }

    this.status.running = false;
    this.controls.setRunning(false);
    this.canvasView.draw(this.gameBoy.getFrameBuffer());
    this.updateDebugPane();
  }

  private stepInstruction(): void {
    if (!this.status.romName) {
      return;
    }

    this.loop.pause();
    this.controls.setRunning(false);
    this.loop.stepInstruction();
    this.updateDebugPane();
  }

  private stepFrame(): void {
    if (!this.status.romName) {
      return;
    }

    this.loop.pause();
    this.controls.setRunning(false);
    this.loop.stepFrame();
    this.updateDebugPane();
  }

  private updateDebugPane(): void {
    const snapshot = this.gameBoy.getDebugSnapshot();
    this.debugPane.update(snapshot, this.gameBoy.getSerialOutput());
  }

  private persistSaveIfDirty(): void {
    if (!this.romHash || !this.gameBoy.isSaveRamDirty()) {
      return;
    }

    this.status.saveState = 'dirty';
    this.controls.setSaveState(this.status.saveState);

    if (this.saveDebounceId !== null) {
      return;
    }

    this.saveDebounceId = window.setTimeout(() => {
      this.saveDebounceId = null;
      this.flushSave();
    }, 500);
  }

  private flushSave(): void {
    if (!this.romHash || !this.gameBoy.isSaveRamDirty()) {
      return;
    }

    const ram = this.gameBoy.exportSaveRam();
    const mapperMeta = this.gameBoy.exportSaveMetadata();
    if (!ram && mapperMeta === null) {
      return;
    }

    const success = this.saveManager.save(this.romHash, ram, mapperMeta);
    this.status.saveState = success ? 'saved' : 'error';
    if (success) {
      this.gameBoy.clearSaveRamDirtyFlag();
    }

    this.controls.setSaveState(this.status.saveState);
  }
}

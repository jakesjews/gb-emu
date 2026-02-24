import { GameBoy } from '../core/system/GameBoy';
import { AudioOutput } from '../runtime/audio/AudioOutput';
import { EmulatorLoop } from '../runtime/EmulatorLoop';
import { GamepadManager } from '../runtime/GamepadManager';
import { SaveManager } from '../runtime/SaveManager';
import type { Button, EmulatorStatus } from '../types/emulator';
import { CanvasView } from './canvasView';
import { Controls } from './controls';
import { DebugPane } from './debugPane';
import { MobileControls } from './mobileControls';
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

  private readonly mobileControls: MobileControls;

  private readonly gamepadManager: GamepadManager;

  private readonly loop: EmulatorLoop;

  private readonly audioOutput: AudioOutput;

  private romHash: string | null = null;

  private saveDebounceId: number | null = null;

  private muted = false;

  private volume = 0.8;

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
      onToggleMute: () => this.toggleMute(),
      onSetVolume: (volume) => this.setVolume(volume),
    });

    this.controls.setRunning(false);
    this.controls.setMuted(this.muted);
    this.controls.setVolume(this.volume);

    this.mobileControls = new MobileControls(screenCard, {
      onSelectRom: async (file) => this.handleRomSelect(file),
      onToggleRun: () => this.toggleRun(),
      onReset: () => this.reset(),
      onButtonState: (button, pressed) => this.gameBoy.setButtonState(button, pressed),
      onUserGesture: () => {
        void this.audioOutput.resumeFromUserGesture();
      },
    });
    this.mobileControls.setRunning(false);
    this.mobileControls.setRomName(null);

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

    this.audioOutput = new AudioOutput(this.gameBoy);
    this.audioOutput.setVolume(this.volume);
    this.audioOutput.setMuted(this.muted);

    this.gameBoy.onFrameFinished((frame) => {
      this.canvasView.draw(frame);
      this.audioOutput.pump();
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
      this.mobileControls.releaseAllVirtualButtons();
      this.gameBoy.releaseAllButtons();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        return;
      }

      this.mobileControls.releaseAllVirtualButtons();
      this.gameBoy.releaseAllButtons();
    });

    window.addEventListener('pagehide', () => {
      this.flushSave();
      this.mobileControls.releaseAllVirtualButtons();
      this.gameBoy.releaseAllButtons();
      void this.audioOutput.close();
    });

    window.addEventListener('beforeunload', () => {
      this.flushSave();
      void this.audioOutput.close();
    });
  }

  private installBrowserHooks(): void {
    window.render_game_to_text = () => {
      const snapshot = this.gameBoy.getDebugSnapshot();
      const audio = this.audioOutput.getStats();
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
        audio: {
          enabled: audio.enabled,
          context_state: audio.contextState,
          buffered_frames: audio.bufferedFrames,
          underruns: audio.underruns,
        },
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
    this.mobileControls.setError('');

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
      this.mobileControls.setRomName(this.status.romName);
      this.controls.setSaveState(this.status.saveState);

      this.loop.reset();
      this.status.running = false;
      this.controls.setRunning(false);
      this.mobileControls.setRunning(false);
      this.audioOutput.setPaused(true);
      void this.audioOutput.resumeFromUserGesture();
      this.canvasView.draw(this.gameBoy.getFrameBuffer());
      this.updateDebugPane();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to load ROM.';
      this.controls.setError(errorMessage);
      this.mobileControls.setError(errorMessage);
      this.status.romName = null;
      this.controls.setRomName(null);
      this.mobileControls.setRomName(null);
    }
  }

  private toggleRun(): void {
    if (!this.status.romName) {
      const message = 'Load a ROM before starting emulation.';
      this.controls.setError(message);
      this.mobileControls.setError(message);
      return;
    }

    this.controls.setError('');
    this.mobileControls.setError('');
    this.loop.toggle();
    this.status.running = this.loop.isRunning();
    this.controls.setRunning(this.status.running);
    this.mobileControls.setRunning(this.status.running);

    if (this.status.running) {
      this.audioOutput.setPaused(false);
      void this.audioOutput.resumeFromUserGesture();
    } else {
      this.audioOutput.setPaused(true);
    }
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
    this.mobileControls.setRunning(false);
    this.audioOutput.setPaused(true);
    this.canvasView.draw(this.gameBoy.getFrameBuffer());
    this.updateDebugPane();
  }

  private stepInstruction(): void {
    if (!this.status.romName) {
      return;
    }

    this.loop.pause();
    this.controls.setRunning(false);
    this.mobileControls.setRunning(false);
    this.audioOutput.setPaused(true);
    this.loop.stepInstruction();
    this.updateDebugPane();
  }

  private stepFrame(): void {
    if (!this.status.romName) {
      return;
    }

    this.loop.pause();
    this.controls.setRunning(false);
    this.mobileControls.setRunning(false);
    this.audioOutput.setPaused(true);
    this.loop.stepFrame();
    this.updateDebugPane();
  }

  private updateDebugPane(): void {
    const snapshot = this.gameBoy.getDebugSnapshot();
    const apuState = this.gameBoy.getAudioDebug();
    const audioStats = this.audioOutput.getStats();
    this.debugPane.update(snapshot, this.gameBoy.getSerialOutput(), {
      masterEnabled: apuState.masterEnabled,
      bufferedFrames: audioStats.bufferedFrames,
      underruns: audioStats.underruns,
    });
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audioOutput.setMuted(this.muted);
    this.controls.setMuted(this.muted);
  }

  private setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.audioOutput.setVolume(this.volume);
    this.controls.setVolume(this.volume);
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

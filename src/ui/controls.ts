interface ControlsHandlers {
  onSelectRom: (file: File) => Promise<void>;
  onToggleRun: () => void;
  onReset: () => void;
  onStepInstruction: () => void;
  onStepFrame: () => void;
}

export class Controls {
  private readonly root: HTMLElement;

  private readonly fileInput: HTMLInputElement;

  private readonly runButton: HTMLButtonElement;

  private readonly resetButton: HTMLButtonElement;

  private readonly stepInstructionButton: HTMLButtonElement;

  private readonly stepFrameButton: HTMLButtonElement;

  private readonly statusLine: HTMLElement;

  private readonly saveLine: HTMLElement;

  private readonly romLine: HTMLElement;

  private readonly errorLine: HTMLElement;

  public constructor(parent: HTMLElement, handlers: ControlsHandlers) {
    this.root = document.createElement('section');
    this.root.className = 'controls-card';

    const title = document.createElement('h1');
    title.textContent = 'GB-EMU DMG';

    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Load a legal .gb ROM from disk, then play with keyboard or gamepad.';

    const uploadRow = document.createElement('div');
    uploadRow.className = 'control-row';

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.gb,.gbc,application/octet-stream';
    this.fileInput.className = 'rom-input';

    uploadRow.append(this.fileInput);

    const buttons = document.createElement('div');
    buttons.className = 'control-grid';

    this.runButton = this.makeButton('Run', handlers.onToggleRun);
    this.resetButton = this.makeButton('Reset', handlers.onReset);
    this.stepInstructionButton = this.makeButton('Step Op', handlers.onStepInstruction);
    this.stepFrameButton = this.makeButton('Step Frame', handlers.onStepFrame);

    buttons.append(this.runButton, this.resetButton, this.stepInstructionButton, this.stepFrameButton);

    const status = document.createElement('div');
    status.className = 'status-grid';
    this.statusLine = document.createElement('span');
    this.romLine = document.createElement('span');
    this.saveLine = document.createElement('span');
    this.errorLine = document.createElement('span');
    this.errorLine.className = 'error-line';

    this.statusLine.textContent = 'Status: paused';
    this.romLine.textContent = 'ROM: none';
    this.saveLine.textContent = 'Save: idle';
    this.errorLine.textContent = '';

    status.append(this.statusLine, this.romLine, this.saveLine, this.errorLine);

    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = 'Keyboard: arrows = D-pad, X = A, Z = B, Enter = Start, Shift = Select, F = fullscreen.';

    this.root.append(title, subtitle, uploadRow, buttons, status, help);
    parent.append(this.root);

    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      if (!file) {
        return;
      }

      await handlers.onSelectRom(file);
    });
  }

  public setRunning(running: boolean): void {
    this.runButton.textContent = running ? 'Pause' : 'Run';
    this.statusLine.textContent = `Status: ${running ? 'running' : 'paused'}`;
  }

  public setFps(fps: number, frameCount: number): void {
    const rounded = Number.isFinite(fps) ? fps.toFixed(1) : '0.0';
    this.statusLine.textContent = `Status: ${this.runButton.textContent === 'Pause' ? 'running' : 'paused'} | FPS ${rounded} | Frames ${frameCount}`;
  }

  public setRomName(name: string | null): void {
    this.romLine.textContent = `ROM: ${name ?? 'none'}`;
  }

  public setSaveState(value: string): void {
    this.saveLine.textContent = `Save: ${value}`;
  }

  public setError(message: string): void {
    this.errorLine.textContent = message;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
}

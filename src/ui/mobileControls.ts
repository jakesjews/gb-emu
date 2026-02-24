import type { Button } from '../types/emulator';

export interface MobileControlsHandlers {
  onSelectRom: (file: File) => Promise<void>;
  onToggleRun: () => void;
  onReset: () => void;
  onButtonState: (button: Button, pressed: boolean) => void;
  onUserGesture?: () => void;
}

const ALL_BUTTONS: Button[] = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

export class MobileControls {
  private readonly root: HTMLElement;

  private readonly fileInput: HTMLInputElement;

  private readonly runButton: HTMLButtonElement;

  private readonly resetButton: HTMLButtonElement;

  private readonly romLine: HTMLElement;

  private readonly statusLine: HTMLElement;

  private readonly errorLine: HTMLElement;

  private readonly handlers: MobileControlsHandlers;

  private readonly pointerToButton = new Map<number, Button>();

  private readonly pressCounts: Record<Button, number> = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    a: 0,
    b: 0,
    start: 0,
    select: 0,
  };

  public constructor(parent: HTMLElement, handlers: MobileControlsHandlers) {
    this.handlers = handlers;

    this.root = document.createElement('section');
    this.root.className = 'mobile-controls-card';
    this.root.setAttribute('aria-label', 'Mobile controls');

    const title = document.createElement('h2');
    title.textContent = 'Mobile Play';

    const topRow = document.createElement('div');
    topRow.className = 'mobile-top-row';

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.gb,.gbc,application/octet-stream';
    this.fileInput.className = 'mobile-rom-input';
    this.fileInput.setAttribute('aria-label', 'Load ROM');

    topRow.append(this.fileInput);

    const actionRow = document.createElement('div');
    actionRow.className = 'mobile-action-row';

    this.runButton = this.makeActionButton('Run', 'run', () => {
      this.handlers.onUserGesture?.();
      this.handlers.onToggleRun();
    });

    this.resetButton = this.makeActionButton('Reset', 'reset', () => {
      this.handlers.onUserGesture?.();
      this.handlers.onReset();
    });

    actionRow.append(this.runButton, this.resetButton);

    const pads = document.createElement('div');
    pads.className = 'mobile-pad-wrap';

    const dpad = document.createElement('div');
    dpad.className = 'mobile-dpad-grid';
    dpad.append(
      this.makeVirtualButton('▲', 'up', 'mobile-up'),
      this.makeVirtualButton('◀', 'left', 'mobile-left'),
      this.makeVirtualButton('▶', 'right', 'mobile-right'),
      this.makeVirtualButton('▼', 'down', 'mobile-down'),
    );

    const actions = document.createElement('div');
    actions.className = 'mobile-action-pad';
    actions.append(
      this.makeVirtualButton('A', 'a', 'mobile-a'),
      this.makeVirtualButton('B', 'b', 'mobile-b'),
    );

    pads.append(dpad, actions);

    const menuRow = document.createElement('div');
    menuRow.className = 'mobile-menu-row';
    menuRow.append(
      this.makeVirtualButton('Select', 'select', 'mobile-select'),
      this.makeVirtualButton('Start', 'start', 'mobile-start'),
    );

    const status = document.createElement('div');
    status.className = 'mobile-status';
    this.statusLine = document.createElement('span');
    this.romLine = document.createElement('span');
    this.errorLine = document.createElement('span');
    this.errorLine.className = 'mobile-error-line';
    this.statusLine.textContent = 'Status: paused';
    this.romLine.textContent = 'ROM: none';
    status.append(this.statusLine, this.romLine, this.errorLine);

    this.root.append(title, topRow, actionRow, pads, menuRow, status);
    parent.append(this.root);

    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      if (!file) {
        return;
      }

      this.handlers.onUserGesture?.();
      await this.handlers.onSelectRom(file);
    });

    window.addEventListener('blur', () => {
      this.releaseAllVirtualButtons();
    });

    window.addEventListener('pagehide', () => {
      this.releaseAllVirtualButtons();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseAllVirtualButtons();
      }
    });
  }

  public setRunning(running: boolean): void {
    this.runButton.textContent = running ? 'Pause' : 'Run';
    this.statusLine.textContent = `Status: ${running ? 'running' : 'paused'}`;
  }

  public setRomName(name: string | null): void {
    this.romLine.textContent = `ROM: ${name ?? 'none'}`;
  }

  public setError(message: string): void {
    this.errorLine.textContent = message;
  }

  public releaseAllVirtualButtons(): void {
    for (const button of ALL_BUTTONS) {
      if (this.pressCounts[button] > 0) {
        this.pressCounts[button] = 0;
        this.handlers.onButtonState(button, false);
      }
    }

    this.pointerToButton.clear();
  }

  private makeActionButton(
    label: string,
    action: 'run' | 'reset',
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-action-btn';
    button.dataset.mobileAction = action;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private makeVirtualButton(label: string, button: Button, className: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `mobile-virtual-btn ${className}`;
    element.dataset.mobileBtn = button;
    element.textContent = label;

    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.handlers.onUserGesture?.();
      this.pressPointer(event.pointerId, button);
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events in tests may not support capture.
      }
    });

    element.addEventListener('pointerup', (event) => {
      event.preventDefault();
      this.releasePointer(event.pointerId);
    });

    element.addEventListener('pointercancel', (event) => {
      event.preventDefault();
      this.releasePointer(event.pointerId);
    });

    element.addEventListener('lostpointercapture', (event) => {
      event.preventDefault();
      this.releasePointer(event.pointerId);
    });

    return element;
  }

  private pressPointer(pointerId: number, button: Button): void {
    const existing = this.pointerToButton.get(pointerId);
    if (existing === button) {
      return;
    }

    if (existing) {
      this.decrementButton(existing);
    }

    this.pointerToButton.set(pointerId, button);
    this.incrementButton(button);
  }

  private releasePointer(pointerId: number): void {
    const button = this.pointerToButton.get(pointerId);
    if (!button) {
      return;
    }

    this.pointerToButton.delete(pointerId);
    this.decrementButton(button);
  }

  private incrementButton(button: Button): void {
    const next = this.pressCounts[button] + 1;
    this.pressCounts[button] = next;
    if (next === 1) {
      this.handlers.onButtonState(button, true);
    }
  }

  private decrementButton(button: Button): void {
    if (this.pressCounts[button] <= 0) {
      this.pressCounts[button] = 0;
      return;
    }

    const next = this.pressCounts[button] - 1;
    this.pressCounts[button] = next;
    if (next === 0) {
      this.handlers.onButtonState(button, false);
    }
  }
}

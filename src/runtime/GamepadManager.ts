import type { Button } from '../types/emulator';

const GAMEPAD_MAPPING: ReadonlyArray<{ button: Button; index: number }> = [
  { button: 'a', index: 1 },
  { button: 'b', index: 0 },
  { button: 'select', index: 8 },
  { button: 'start', index: 9 },
  { button: 'up', index: 12 },
  { button: 'down', index: 13 },
  { button: 'left', index: 14 },
  { button: 'right', index: 15 },
];

export class GamepadManager {
  private readonly applyButtonState: (button: Button, pressed: boolean) => void;

  public constructor(applyButtonState: (button: Button, pressed: boolean) => void) {
    this.applyButtonState = applyButtonState;
  }

  public poll(): void {
    const gamepads = navigator.getGamepads();
    const pad = gamepads[0];
    if (!pad) {
      return;
    }

    for (const mapping of GAMEPAD_MAPPING) {
      const pressed = pad.buttons[mapping.index]?.pressed ?? false;
      this.applyButtonState(mapping.button, pressed);
    }
  }
}

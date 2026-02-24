export const OPCODE_NAMES: ReadonlyArray<string> = new Array(0x100)
  .fill('UNDEFINED')
  .map((_, index) => `OP_${index.toString(16).padStart(2, '0').toUpperCase()}`);

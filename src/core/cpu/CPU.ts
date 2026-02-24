import { Bus } from '../memory/Bus';
import { InterruptController } from '../interrupts/InterruptController';
import { FLAG_C, FLAG_H, FLAG_N, FLAG_Z } from './flags';
import { Registers } from './registers';

function toSigned8(value: number): number {
  return (value << 24) >> 24;
}

function isHalfCarryAdd8(a: number, b: number, carry = 0): boolean {
  return (a & 0x0f) + (b & 0x0f) + carry > 0x0f;
}

function isCarryAdd8(a: number, b: number, carry = 0): boolean {
  return a + b + carry > 0xff;
}

function isHalfBorrowSub8(a: number, b: number, carry = 0): boolean {
  return (a & 0x0f) - (b & 0x0f) - carry < 0;
}

function isBorrowSub8(a: number, b: number, carry = 0): boolean {
  return a - b - carry < 0;
}

export class CPU {
  public readonly registers = new Registers();

  public ime = false;

  public halted = false;

  public cycles = 0;

  public lastOpcode = 0;

  private pendingEnableIme = false;

  private haltBug = false;

  private timerEarlyTickCycles = 0;

  private nonTimerEarlyTickCycles = 0;

  private readonly bus: Bus;

  private readonly interrupts: InterruptController;

  private readonly timerTickHook?: (cycles: number) => void;

  private readonly nonTimerTickHook?: (cycles: number) => void;

  public constructor(
    bus: Bus,
    interrupts: InterruptController,
    timerTickHook?: (cycles: number) => void,
    nonTimerTickHook?: (cycles: number) => void,
  ) {
    this.bus = bus;
    this.interrupts = interrupts;
    this.timerTickHook = timerTickHook;
    this.nonTimerTickHook = nonTimerTickHook;
  }

  public reset(): void {
    this.registers.resetToDmgBootState();
    this.ime = false;
    this.halted = false;
    this.cycles = 0;
    this.lastOpcode = 0;
    this.pendingEnableIme = false;
    this.haltBug = false;
  }

  public step(): number {
    this.timerEarlyTickCycles = 0;
    this.nonTimerEarlyTickCycles = 0;

    if (this.pendingEnableIme) {
      this.ime = true;
      this.pendingEnableIme = false;
    }

    const pendingMask = this.interrupts.getPendingMask();
    if (pendingMask !== 0) {
      if (this.halted) {
        this.halted = false;
      }

      if (this.ime) {
        const elapsed = this.serviceInterrupt();
        this.cycles += elapsed;
        return elapsed;
      }
    }

    if (this.halted) {
      this.cycles += 4;
      return 4;
    }

    const opcode = this.fetch8();
    this.lastOpcode = opcode;
    const elapsed = this.executeOpcode(opcode);
    this.cycles += elapsed;
    return elapsed;
  }

  private serviceInterrupt(): number {
    this.ime = false;
    this.pendingEnableIme = false;

    const pc = this.registers.pc;
    const hi = (pc >> 8) & 0xff;
    const lo = pc & 0xff;

    // Interrupt dispatch has stack side effects before final vector resolution.
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write8(this.registers.sp, hi);

    const pendingAfterHighPush = this.interrupts.getPendingMask();
    const selectedMask = this.interrupts.getHighestPriorityPendingMask(pendingAfterHighPush);

    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write8(this.registers.sp, lo);

    if (selectedMask === 0) {
      this.registers.pc = 0x0000;
      return 20;
    }

    const vector = this.interrupts.consumePendingByMask(selectedMask) ?? 0x0000;
    this.registers.pc = vector;
    return 20;
  }

  public consumeTimerEarlyTickCycles(): number {
    const cycles = this.timerEarlyTickCycles;
    this.timerEarlyTickCycles = 0;
    return cycles;
  }

  public consumeNonTimerEarlyTickCycles(): number {
    const cycles = this.nonTimerEarlyTickCycles;
    this.nonTimerEarlyTickCycles = 0;
    return cycles;
  }

  private fetch8(): number {
    const value = this.bus.read8(this.registers.pc);

    if (this.haltBug) {
      this.haltBug = false;
    } else {
      this.registers.pc = (this.registers.pc + 1) & 0xffff;
    }

    return value;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  private readR(index: number): number {
    switch (index & 0x07) {
      case 0:
        return this.registers.b;
      case 1:
        return this.registers.c;
      case 2:
        return this.registers.d;
      case 3:
        return this.registers.e;
      case 4:
        return this.registers.h;
      case 5:
        return this.registers.l;
      case 6:
        return this.bus.read8(this.registers.hl);
      case 7:
        return this.registers.a;
      default:
        return 0xff;
    }
  }

  private writeR(index: number, value: number): void {
    const masked = value & 0xff;

    switch (index & 0x07) {
      case 0:
        this.registers.b = masked;
        break;
      case 1:
        this.registers.c = masked;
        break;
      case 2:
        this.registers.d = masked;
        break;
      case 3:
        this.registers.e = masked;
        break;
      case 4:
        this.registers.h = masked;
        break;
      case 5:
        this.registers.l = masked;
        break;
      case 6:
        this.bus.write8(this.registers.hl, masked);
        break;
      case 7:
        this.registers.a = masked;
        break;
      default:
        break;
    }
  }

  private push16(value: number): void {
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write8(this.registers.sp, (value >> 8) & 0xff);
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write8(this.registers.sp, value & 0xff);
  }

  private pop16(): number {
    const lo = this.bus.read8(this.registers.sp);
    this.registers.sp = (this.registers.sp + 1) & 0xffff;
    const hi = this.bus.read8(this.registers.sp);
    this.registers.sp = (this.registers.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }

  private executeOpcode(opcode: number): number {
    if (opcode >= 0x40 && opcode <= 0x7f) {
      if (opcode === 0x76) {
        if (!this.ime && this.interrupts.hasPending()) {
          this.haltBug = true;
        } else {
          this.halted = true;
        }

        return 4;
      }

      const dst = (opcode >> 3) & 0x07;
      const src = opcode & 0x07;
      if (src === 6) {
        this.tickNonTimerEarly(4);
      }
      if (dst === 6) {
        this.tickNonTimerEarly(4);
      }
      this.writeR(dst, this.readR(src));
      return dst === 6 || src === 6 ? 8 : 4;
    }

    if (opcode >= 0x80 && opcode <= 0xbf) {
      const src = opcode & 0x07;
      if (src === 6) {
        this.tickNonTimerEarly(4);
      }
      const value = this.readR(src);

      switch ((opcode >> 3) & 0x07) {
        case 0:
          this.addA(value);
          break;
        case 1:
          this.adcA(value);
          break;
        case 2:
          this.subA(value);
          break;
        case 3:
          this.sbcA(value);
          break;
        case 4:
          this.andA(value);
          break;
        case 5:
          this.xorA(value);
          break;
        case 6:
          this.orA(value);
          break;
        case 7:
          this.cpA(value);
          break;
        default:
          break;
      }

      return src === 6 ? 8 : 4;
    }

    switch (opcode) {
      case 0x00:
        return 4;

      case 0x01:
        this.registers.bc = this.fetch16();
        return 12;
      case 0x02:
        this.tickNonTimerEarly(4);
        this.bus.write8(this.registers.bc, this.registers.a);
        return 8;
      case 0x03:
        this.registers.bc = (this.registers.bc + 1) & 0xffff;
        return 8;
      case 0x04:
        this.registers.b = this.inc8(this.registers.b);
        return 4;
      case 0x05:
        this.registers.b = this.dec8(this.registers.b);
        return 4;
      case 0x06:
        this.registers.b = this.fetch8();
        return 8;
      case 0x07:
        this.rlca();
        return 4;
      case 0x08: {
        const addr = this.fetch16();
        this.bus.write16(addr, this.registers.sp);
        return 20;
      }
      case 0x09:
        this.addHL(this.registers.bc);
        return 8;
      case 0x0a:
        this.tickNonTimerEarly(4);
        this.registers.a = this.bus.read8(this.registers.bc);
        return 8;
      case 0x0b:
        this.registers.bc = (this.registers.bc - 1) & 0xffff;
        return 8;
      case 0x0c:
        this.registers.c = this.inc8(this.registers.c);
        return 4;
      case 0x0d:
        this.registers.c = this.dec8(this.registers.c);
        return 4;
      case 0x0e:
        this.registers.c = this.fetch8();
        return 8;
      case 0x0f:
        this.rrca();
        return 4;

      case 0x10:
        this.fetch8();
        this.halted = true;
        return 4;

      case 0x11:
        this.registers.de = this.fetch16();
        return 12;
      case 0x12:
        this.tickNonTimerEarly(4);
        this.bus.write8(this.registers.de, this.registers.a);
        return 8;
      case 0x13:
        this.registers.de = (this.registers.de + 1) & 0xffff;
        return 8;
      case 0x14:
        this.registers.d = this.inc8(this.registers.d);
        return 4;
      case 0x15:
        this.registers.d = this.dec8(this.registers.d);
        return 4;
      case 0x16:
        this.registers.d = this.fetch8();
        return 8;
      case 0x17:
        this.rla();
        return 4;
      case 0x18:
        {
          const offset = toSigned8(this.fetch8());
          this.registers.pc = (this.registers.pc + offset) & 0xffff;
        }
        return 12;
      case 0x19:
        this.addHL(this.registers.de);
        return 8;
      case 0x1a:
        this.tickNonTimerEarly(4);
        this.registers.a = this.bus.read8(this.registers.de);
        return 8;
      case 0x1b:
        this.registers.de = (this.registers.de - 1) & 0xffff;
        return 8;
      case 0x1c:
        this.registers.e = this.inc8(this.registers.e);
        return 4;
      case 0x1d:
        this.registers.e = this.dec8(this.registers.e);
        return 4;
      case 0x1e:
        this.registers.e = this.fetch8();
        return 8;
      case 0x1f:
        this.rra();
        return 4;

      case 0x20:
        return this.jrCondition(!this.registers.getFlag(FLAG_Z));
      case 0x21:
        this.registers.hl = this.fetch16();
        return 12;
      case 0x22:
        this.tickNonTimerEarly(4);
        this.bus.write8(this.registers.hl, this.registers.a);
        this.registers.hl = (this.registers.hl + 1) & 0xffff;
        return 8;
      case 0x23:
        this.registers.hl = (this.registers.hl + 1) & 0xffff;
        return 8;
      case 0x24:
        this.registers.h = this.inc8(this.registers.h);
        return 4;
      case 0x25:
        this.registers.h = this.dec8(this.registers.h);
        return 4;
      case 0x26:
        this.registers.h = this.fetch8();
        return 8;
      case 0x27:
        this.daa();
        return 4;
      case 0x28:
        return this.jrCondition(this.registers.getFlag(FLAG_Z));
      case 0x29:
        this.addHL(this.registers.hl);
        return 8;
      case 0x2a:
        this.tickNonTimerEarly(4);
        this.registers.a = this.bus.read8(this.registers.hl);
        this.registers.hl = (this.registers.hl + 1) & 0xffff;
        return 8;
      case 0x2b:
        this.registers.hl = (this.registers.hl - 1) & 0xffff;
        return 8;
      case 0x2c:
        this.registers.l = this.inc8(this.registers.l);
        return 4;
      case 0x2d:
        this.registers.l = this.dec8(this.registers.l);
        return 4;
      case 0x2e:
        this.registers.l = this.fetch8();
        return 8;
      case 0x2f:
        this.registers.a = ~this.registers.a & 0xff;
        this.registers.setSubtract(true);
        this.registers.setHalfCarry(true);
        return 4;

      case 0x30:
        return this.jrCondition(!this.registers.getFlag(FLAG_C));
      case 0x31:
        this.registers.sp = this.fetch16();
        return 12;
      case 0x32:
        this.tickNonTimerEarly(4);
        this.bus.write8(this.registers.hl, this.registers.a);
        this.registers.hl = (this.registers.hl - 1) & 0xffff;
        return 8;
      case 0x33:
        this.registers.sp = (this.registers.sp + 1) & 0xffff;
        return 8;
      case 0x34: {
        const value = this.bus.read8(this.registers.hl);
        this.tickTimerEarly(4);
        this.bus.write8(this.registers.hl, this.inc8(value));
        return 12;
      }
      case 0x35: {
        const value = this.bus.read8(this.registers.hl);
        this.tickTimerEarly(4);
        this.bus.write8(this.registers.hl, this.dec8(value));
        return 12;
      }
      case 0x36:
        {
          const value = this.fetch8();
          this.tickTimerEarly(4);
          this.bus.write8(this.registers.hl, value);
        }
        return 12;
      case 0x37:
        this.registers.setSubtract(false);
        this.registers.setHalfCarry(false);
        this.registers.setCarry(true);
        return 4;
      case 0x38:
        return this.jrCondition(this.registers.getFlag(FLAG_C));
      case 0x39:
        this.addHL(this.registers.sp);
        return 8;
      case 0x3a:
        this.tickNonTimerEarly(4);
        this.registers.a = this.bus.read8(this.registers.hl);
        this.registers.hl = (this.registers.hl - 1) & 0xffff;
        return 8;
      case 0x3b:
        this.registers.sp = (this.registers.sp - 1) & 0xffff;
        return 8;
      case 0x3c:
        this.registers.a = this.inc8(this.registers.a);
        return 4;
      case 0x3d:
        this.registers.a = this.dec8(this.registers.a);
        return 4;
      case 0x3e:
        this.registers.a = this.fetch8();
        return 8;
      case 0x3f:
        this.registers.setSubtract(false);
        this.registers.setHalfCarry(false);
        this.registers.setCarry(!this.registers.getFlag(FLAG_C));
        return 4;

      case 0xc0:
        return this.retCondition(!this.registers.getFlag(FLAG_Z));
      case 0xc1:
        this.registers.bc = this.pop16();
        return 12;
      case 0xc2:
        return this.jpCondition(!this.registers.getFlag(FLAG_Z));
      case 0xc3:
        this.registers.pc = this.fetch16();
        return 16;
      case 0xc4:
        return this.callCondition(!this.registers.getFlag(FLAG_Z));
      case 0xc5:
        this.push16(this.registers.bc);
        return 16;
      case 0xc6:
        this.addA(this.fetch8());
        return 8;
      case 0xc7:
        this.rst(0x00);
        return 16;
      case 0xc8:
        return this.retCondition(this.registers.getFlag(FLAG_Z));
      case 0xc9:
        this.registers.pc = this.pop16();
        return 16;
      case 0xca:
        return this.jpCondition(this.registers.getFlag(FLAG_Z));
      case 0xcb:
        return this.executeCB(this.fetch8());
      case 0xcc:
        return this.callCondition(this.registers.getFlag(FLAG_Z));
      case 0xcd: {
        const addr = this.fetch16();
        this.push16(this.registers.pc);
        this.registers.pc = addr;
        return 24;
      }
      case 0xce:
        this.adcA(this.fetch8());
        return 8;
      case 0xcf:
        this.rst(0x08);
        return 16;

      case 0xd0:
        return this.retCondition(!this.registers.getFlag(FLAG_C));
      case 0xd1:
        this.registers.de = this.pop16();
        return 12;
      case 0xd2:
        return this.jpCondition(!this.registers.getFlag(FLAG_C));
      case 0xd3:
        return 4;
      case 0xd4:
        return this.callCondition(!this.registers.getFlag(FLAG_C));
      case 0xd5:
        this.push16(this.registers.de);
        return 16;
      case 0xd6:
        this.subA(this.fetch8());
        return 8;
      case 0xd7:
        this.rst(0x10);
        return 16;
      case 0xd8:
        return this.retCondition(this.registers.getFlag(FLAG_C));
      case 0xd9:
        this.registers.pc = this.pop16();
        this.ime = true;
        return 16;
      case 0xda:
        return this.jpCondition(this.registers.getFlag(FLAG_C));
      case 0xdb:
        return 4;
      case 0xdc:
        return this.callCondition(this.registers.getFlag(FLAG_C));
      case 0xdd:
        return 4;
      case 0xde:
        this.sbcA(this.fetch8());
        return 8;
      case 0xdf:
        this.rst(0x18);
        return 16;

      case 0xe0:
        {
          const offset = this.fetch8();
          this.tickTimerEarly(4);
          this.tickNonTimerEarly(4);
          this.bus.write8(0xff00 + offset, this.registers.a);
        }
        return 12;
      case 0xe1:
        this.registers.hl = this.pop16();
        return 12;
      case 0xe2:
        this.tickNonTimerEarly(4);
        this.bus.write8(0xff00 + this.registers.c, this.registers.a);
        return 8;
      case 0xe3:
      case 0xe4:
        return 4;
      case 0xe5:
        this.push16(this.registers.hl);
        return 16;
      case 0xe6:
        this.andA(this.fetch8());
        return 8;
      case 0xe7:
        this.rst(0x20);
        return 16;
      case 0xe8:
        this.addSpSigned(this.fetch8());
        return 16;
      case 0xe9:
        this.registers.pc = this.registers.hl;
        return 4;
      case 0xea:
        {
          const address = this.fetch16();
          this.tickTimerEarly(8);
          this.tickNonTimerEarly(8);
          this.bus.write8(address, this.registers.a);
        }
        return 16;
      case 0xeb:
      case 0xec:
      case 0xed:
        return 4;
      case 0xee:
        this.xorA(this.fetch8());
        return 8;
      case 0xef:
        this.rst(0x28);
        return 16;

      case 0xf0:
        {
          const offset = this.fetch8();
          this.tickTimerEarly(4);
          this.tickNonTimerEarly(4);
          this.registers.a = this.bus.read8(0xff00 + offset);
        }
        return 12;
      case 0xf1:
        this.registers.af = this.pop16();
        return 12;
      case 0xf2:
        this.tickNonTimerEarly(4);
        this.registers.a = this.bus.read8(0xff00 + this.registers.c);
        return 8;
      case 0xf3:
        this.ime = false;
        this.pendingEnableIme = false;
        return 4;
      case 0xf4:
        return 4;
      case 0xf5:
        this.push16(this.registers.af);
        return 16;
      case 0xf6:
        this.orA(this.fetch8());
        return 8;
      case 0xf7:
        this.rst(0x30);
        return 16;
      case 0xf8:
        this.ldHlSpSigned(this.fetch8());
        return 12;
      case 0xf9:
        this.registers.sp = this.registers.hl;
        return 8;
      case 0xfa:
        {
          const address = this.fetch16();
          this.tickTimerEarly(8);
          this.tickNonTimerEarly(8);
          this.registers.a = this.bus.read8(address);
        }
        return 16;
      case 0xfb:
        this.pendingEnableIme = true;
        return 4;
      case 0xfc:
      case 0xfd:
        return 4;
      case 0xfe:
        this.cpA(this.fetch8());
        return 8;
      case 0xff:
        this.rst(0x38);
        return 16;

      default:
        return 4;
    }
  }

  private executeCB(opcode: number): number {
    const reg = opcode & 0x07;
    const isBitInstruction = opcode >= 0x40 && opcode <= 0x7f;
    if (reg === 6) {
      this.tickTimerEarly(4);
    }

    const value = this.readR(reg);

    let result = value;
    let writeBack = true;

    if (opcode <= 0x07) {
      const carry = (value >> 7) & 1;
      result = ((value << 1) | carry) & 0xff;
      this.setRotateFlags(result, carry);
    } else if (opcode <= 0x0f) {
      const carry = value & 1;
      result = ((value >> 1) | (carry << 7)) & 0xff;
      this.setRotateFlags(result, carry);
    } else if (opcode <= 0x17) {
      const carryIn = this.registers.getFlag(FLAG_C) ? 1 : 0;
      const carryOut = (value >> 7) & 1;
      result = ((value << 1) | carryIn) & 0xff;
      this.setRotateFlags(result, carryOut);
    } else if (opcode <= 0x1f) {
      const carryIn = this.registers.getFlag(FLAG_C) ? 1 : 0;
      const carryOut = value & 1;
      result = ((value >> 1) | (carryIn << 7)) & 0xff;
      this.setRotateFlags(result, carryOut);
    } else if (opcode <= 0x27) {
      const carry = (value >> 7) & 1;
      result = (value << 1) & 0xff;
      this.setRotateFlags(result, carry);
    } else if (opcode <= 0x2f) {
      const carry = value & 1;
      result = ((value >> 1) | (value & 0x80)) & 0xff;
      this.setRotateFlags(result, carry);
    } else if (opcode <= 0x37) {
      result = ((value & 0x0f) << 4) | ((value & 0xf0) >> 4);
      this.registers.setZero(result === 0);
      this.registers.setSubtract(false);
      this.registers.setHalfCarry(false);
      this.registers.setCarry(false);
    } else if (opcode <= 0x3f) {
      const carry = value & 1;
      result = (value >> 1) & 0xff;
      this.setRotateFlags(result, carry);
    } else if (isBitInstruction) {
      const bit = (opcode >> 3) & 0x07;
      this.registers.setZero(((value >> bit) & 0x01) === 0);
      this.registers.setSubtract(false);
      this.registers.setHalfCarry(true);
      writeBack = false;
    } else if (opcode <= 0xbf) {
      const bit = (opcode >> 3) & 0x07;
      result = value & ~(1 << bit);
    } else {
      const bit = (opcode >> 3) & 0x07;
      result = value | (1 << bit);
    }

    if (writeBack) {
      if (reg === 6 && !isBitInstruction) {
        this.tickTimerEarly(4);
      }
      this.writeR(reg, result);
    }

    if (reg === 6) {
      if (opcode >= 0x40 && opcode <= 0x7f) {
        return 12;
      }

      return 16;
    }

    return 8;
  }

  private setRotateFlags(value: number, carry: number): void {
    this.registers.setZero((value & 0xff) === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carry !== 0);
  }

  private addA(value: number): void {
    const a = this.registers.a;
    const result = (a + value) & 0xff;
    this.registers.a = result;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(isHalfCarryAdd8(a, value));
    this.registers.setCarry(isCarryAdd8(a, value));
  }

  private adcA(value: number): void {
    const carry = this.registers.getFlag(FLAG_C) ? 1 : 0;
    const a = this.registers.a;
    const result = (a + value + carry) & 0xff;
    this.registers.a = result;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(isHalfCarryAdd8(a, value, carry));
    this.registers.setCarry(isCarryAdd8(a, value, carry));
  }

  private subA(value: number): void {
    const a = this.registers.a;
    const result = (a - value) & 0xff;
    this.registers.a = result;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(true);
    this.registers.setHalfCarry(isHalfBorrowSub8(a, value));
    this.registers.setCarry(isBorrowSub8(a, value));
  }

  private sbcA(value: number): void {
    const carry = this.registers.getFlag(FLAG_C) ? 1 : 0;
    const a = this.registers.a;
    const result = (a - value - carry) & 0xff;
    this.registers.a = result;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(true);
    this.registers.setHalfCarry(isHalfBorrowSub8(a, value, carry));
    this.registers.setCarry(isBorrowSub8(a, value, carry));
  }

  private andA(value: number): void {
    this.registers.a &= value;
    this.registers.setZero(this.registers.a === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(true);
    this.registers.setCarry(false);
  }

  private xorA(value: number): void {
    this.registers.a ^= value;
    this.registers.setZero(this.registers.a === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(false);
  }

  private orA(value: number): void {
    this.registers.a |= value;
    this.registers.setZero(this.registers.a === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(false);
  }

  private cpA(value: number): void {
    const a = this.registers.a;
    const result = (a - value) & 0xff;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(true);
    this.registers.setHalfCarry(isHalfBorrowSub8(a, value));
    this.registers.setCarry(isBorrowSub8(a, value));
  }

  private inc8(value: number): number {
    const result = (value + 1) & 0xff;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry((value & 0x0f) + 1 > 0x0f);
    return result;
  }

  private dec8(value: number): number {
    const result = (value - 1) & 0xff;
    this.registers.setZero(result === 0);
    this.registers.setSubtract(true);
    this.registers.setHalfCarry((value & 0x0f) === 0);
    return result;
  }

  private addHL(value: number): void {
    const hl = this.registers.hl;
    const result = (hl + value) & 0xffff;
    this.registers.setSubtract(false);
    this.registers.setHalfCarry((hl & 0x0fff) + (value & 0x0fff) > 0x0fff);
    this.registers.setCarry(hl + value > 0xffff);
    this.registers.hl = result;
  }

  private rlca(): void {
    const carry = (this.registers.a >> 7) & 1;
    this.registers.a = ((this.registers.a << 1) | carry) & 0xff;
    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carry === 1);
  }

  private rla(): void {
    const carryIn = this.registers.getFlag(FLAG_C) ? 1 : 0;
    const carryOut = (this.registers.a >> 7) & 1;
    this.registers.a = ((this.registers.a << 1) | carryIn) & 0xff;
    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carryOut === 1);
  }

  private rrca(): void {
    const carry = this.registers.a & 1;
    this.registers.a = ((this.registers.a >> 1) | (carry << 7)) & 0xff;
    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carry === 1);
  }

  private rra(): void {
    const carryIn = this.registers.getFlag(FLAG_C) ? 1 : 0;
    const carryOut = this.registers.a & 1;
    this.registers.a = ((this.registers.a >> 1) | (carryIn << 7)) & 0xff;
    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carryOut === 1);
  }

  private daa(): void {
    let a = this.registers.a;
    let adjustment = 0;
    let carry = this.registers.getFlag(FLAG_C);

    if (!this.registers.getFlag(FLAG_N)) {
      if (this.registers.getFlag(FLAG_H) || (a & 0x0f) > 9) {
        adjustment |= 0x06;
      }

      if (carry || a > 0x99) {
        adjustment |= 0x60;
        carry = true;
      }

      a = (a + adjustment) & 0xff;
    } else {
      if (this.registers.getFlag(FLAG_H)) {
        adjustment |= 0x06;
      }

      if (carry) {
        adjustment |= 0x60;
      }

      a = (a - adjustment) & 0xff;
    }

    this.registers.a = a;
    this.registers.setZero(a === 0);
    this.registers.setHalfCarry(false);
    this.registers.setCarry(carry);
  }

  private jrCondition(condition: boolean): number {
    const offset = toSigned8(this.fetch8());
    if (condition) {
      this.registers.pc = (this.registers.pc + offset) & 0xffff;
      return 12;
    }

    return 8;
  }

  private jpCondition(condition: boolean): number {
    const address = this.fetch16();
    if (condition) {
      this.registers.pc = address;
      return 16;
    }

    return 12;
  }

  private callCondition(condition: boolean): number {
    const address = this.fetch16();
    if (condition) {
      this.push16(this.registers.pc);
      this.registers.pc = address;
      return 24;
    }

    return 12;
  }

  private retCondition(condition: boolean): number {
    if (condition) {
      this.registers.pc = this.pop16();
      return 20;
    }

    return 8;
  }

  private rst(vector: number): void {
    this.push16(this.registers.pc);
    this.registers.pc = vector & 0xff;
  }

  private addSpSigned(rawOffset: number): void {
    const offset = toSigned8(rawOffset);
    const sp = this.registers.sp;
    const result = (sp + offset) & 0xffff;

    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry((sp & 0x0f) + (rawOffset & 0x0f) > 0x0f);
    this.registers.setCarry((sp & 0xff) + (rawOffset & 0xff) > 0xff);

    this.registers.sp = result;
  }

  private ldHlSpSigned(rawOffset: number): void {
    const offset = toSigned8(rawOffset);
    const sp = this.registers.sp;
    const result = (sp + offset) & 0xffff;

    this.registers.setZero(false);
    this.registers.setSubtract(false);
    this.registers.setHalfCarry((sp & 0x0f) + (rawOffset & 0x0f) > 0x0f);
    this.registers.setCarry((sp & 0xff) + (rawOffset & 0xff) > 0xff);

    this.registers.hl = result;
  }

  private tickTimerEarly(cycles: number): void {
    if (cycles <= 0) {
      return;
    }

    this.timerEarlyTickCycles += cycles;
    this.timerTickHook?.(cycles);
  }

  private tickNonTimerEarly(cycles: number): void {
    if (cycles <= 0) {
      return;
    }

    this.nonTimerEarlyTickCycles += cycles;
    this.nonTimerTickHook?.(cycles);
  }
}

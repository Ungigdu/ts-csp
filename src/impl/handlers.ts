import noop from 'lodash/noop';
import { Box } from './boxes';

export interface IHandler {
  isActive(): boolean;
  commit(): Function;
  isBlockable(): boolean;
}

export class FnHandler implements IHandler{
  blockable: boolean;
  func: Function;

  constructor(blockable: boolean, func?: Function) {
    this.blockable = blockable;
    // In TypeScript, we explicitly check if func is provided or fallback to noop.
    // This is slightly more verbose than Flow's nullable type but provides clarity and strict type checking.
    this.func = func || noop;
  }

  isActive(): boolean {
    return true;
  }

  isBlockable(): boolean {
    return this.blockable;
  }

  commit(): Function {
    return this.func;
  }
}

export class AltHandler implements IHandler{
  flag: Box<boolean>;
  func: Function

  constructor(flag: Box<boolean>, func: Function) {
    this.flag = flag;
    this.func = func;
  }

  isActive(): boolean {
    return this.flag.value;
  }

  isBlockable(): boolean {
    return true;
  }

  commit(): Function {
    this.flag.value = false;
    return this.func;
  }
}
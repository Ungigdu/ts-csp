import { doAlts } from './select';
import { FnHandler } from './handlers';
import {
  TakeInstruction,
  PutInstruction,
  SleepInstruction,
  AltsInstruction,
} from './instruction';
import { Box } from './boxes';
import { Channel } from './channels';
import { queueDelay } from './dispatch';
import { BoxType } from './channels';

export const NO_VALUE = '@@process/NO_VALUE';

export function putThenCallback<T>(
  channel: Channel<T>,
  value: T,
  callback?: Function
): void {
  const result: BoxType<boolean> | null = channel.put(value, new FnHandler(true, callback));

  if (result && callback) {
    callback(result.value);
  }
}

export function takeThenCallback<T>(channel: Channel<T>, callback?: Function): void {
  const result: BoxType<T> | null = channel.take(new FnHandler(true, callback));

  if (result && callback) {
    callback(result.value);
  }
}

export function take<T>(channel: Channel<T>): TakeInstruction<T> {
  return new TakeInstruction(channel);
}

export function put<T>(channel: Channel<T>, value: unknown): PutInstruction<T> {
  return new PutInstruction(channel, value);
}

export function sleep(msecs: number): SleepInstruction {
  return new SleepInstruction(msecs);
}

export function alts<T>(
  operations: Channel<T>[] | [Channel<T>, any][],
  options?: any
): AltsInstruction<T> {
  return new AltsInstruction(operations, options);
}

export function poll<T>(channel: Channel<T>): unknown | typeof NO_VALUE {
  if (channel.closed) {
    return null;
  }

  const result: BoxType<T> | null = channel.take(new FnHandler(false));

  return result ? result.value : null;
}

export function offer<T>(channel: Channel<T>, value: T): boolean {
  if (channel.closed) {
    return false;
  }

  const result: BoxType<boolean> | null = channel.put(value, new FnHandler(false));

  return result instanceof Box;
}

export class Process<T> {
  gen: Generator<T, void, unknown>;
  onFinishFunc: Function;
  finished: boolean;

  constructor(gen: Generator<T, void, unknown>, onFinishFunc: Function) {
    this.gen = gen;
    this.finished = false;
    this.onFinishFunc = onFinishFunc;
  }

  schedule = (nextState: unknown): void => {
    setImmediate(() => this.run(nextState));
  };

  run(state: unknown): void {
    if (!this.finished) {
      // TODO: Shouldn't we (optionally) stop error propagation here (and
      // signal the error through a channel or something)? Otherwise the
      // uncaught exception will crash some runtimes (e.g. Node)
      const { done, value } = this.gen.next(state);

      if (done) {
        this.finished = true;
        this.onFinishFunc(value);
      } else if (value instanceof TakeInstruction) {
        takeThenCallback(value.channel, this.schedule);
      } else if (value instanceof PutInstruction) {
        putThenCallback(value.channel, value.value, this.schedule);
      } else if (value instanceof SleepInstruction) {
        queueDelay(this.schedule, value.msec);
      } else if (value instanceof AltsInstruction) {
        doAlts(value.operations, this.schedule, value.options);
      } else if (value instanceof Channel) {
        takeThenCallback(value, this.schedule);
      } else {
        this.schedule(value);
      }
    }
  }
}

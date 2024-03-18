import type { BufferType } from './impl/buffers';
import { fixed, promise } from './impl/buffers';
import { putThenCallback, Process } from './impl/process';
import { chan as channel, Channel, CLOSED } from './impl/channels';
import { Transformer } from "transducers.js";

export function spawn<T>(gen: Generator<T, void, unknown>): Channel<T> {
  const ch = channel<T>(fixed(1));
  const process = new Process(gen, (value: T) => {
    if (value === CLOSED) {
      ch.close();
    } else {
      putThenCallback(ch, value, () => ch.close());
    }
  });

  process.run(null);
  return ch;
}

export function go<T>(f: Function, args: unknown[] = []): Channel<T> {
  return spawn(f(...args));
}

export function chan<T>(
  bufferOrNumber?: BufferType<T> | number,
  xform?: (transformer: Transformer<any, any>) => Transformer<any, any>,
  exHandler?: (error: Error) => unknown
): Channel<T> {
  if (typeof bufferOrNumber === 'number') {
    return channel(
      bufferOrNumber === 0 ? null : fixed(bufferOrNumber),
      xform,
      exHandler
    );
  }

  return channel(bufferOrNumber, xform, exHandler);
}

export function promiseChan<T>(xform?: (transformer: Transformer<any, any>) => Transformer<any, any>, exHandler?: (error: Error) => unknown): Channel<T> {
  return channel(promise(), xform, exHandler);
}

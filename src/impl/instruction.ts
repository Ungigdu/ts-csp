import { Channel } from './channels';

export class TakeInstruction<T> {
  channel: Channel<T>;

  constructor(channel: Channel<T>) {
    this.channel = channel;
  }
}

export class PutInstruction<T> {
  channel: Channel<T>;
  value: any;

  constructor(channel: Channel<T>, value: any) {
    this.channel = channel;
    this.value = value;
  }
}

export class SleepInstruction {
  msec: number;

  constructor(msec: number) {
    this.msec = msec;
  }
}

export class AltsInstruction<T> {
  // The operations can be either an array of Channels or an array of tuples [Channel, value].
  operations: Array<Channel<T> | [Channel<T>, any]>;
  // For options, you may want to define a more specific type if you know the structure of the options object.
  options: Record<string, any>;

  constructor(operations: Array<Channel<T> | [Channel<T>, any]>, options?: Record<string, any>) {
    this.operations = operations;
    this.options = options || {};
  }
}

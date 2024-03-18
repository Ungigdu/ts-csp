import { Channel } from './channels';

export const DEFAULT = {
  toString(): string {
    return '[object DEFAULT]';
  },
};

export class AltResult<T> {
  value: T;
  channel: Channel<T> | typeof DEFAULT;

  constructor(value: T, channel: Channel<T> | typeof DEFAULT) {
    this.value = value;
    this.channel = channel;
  }
}

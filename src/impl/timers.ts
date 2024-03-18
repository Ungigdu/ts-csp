import { queueDelay } from './dispatch';
import { chan, Channel } from './channels';

export function timeout<T>(msecs: number): Channel<T> {
  const ch: Channel<T> = chan<T>();
  queueDelay(() => ch.close(), msecs);
  return ch;
}

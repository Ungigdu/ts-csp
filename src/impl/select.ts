import has from 'lodash/get';
import range from 'lodash/range';
import shuffle from 'lodash/shuffle'; // Adjusted to use public API shuffle
import { Box} from './boxes';
import { Channel, BoxType } from './channels';
import { AltHandler } from './handlers';
import { AltResult, DEFAULT } from './results';

// Define a type for the operations parameter to improve readability and maintainability
type Operation<T> = Channel<T> | [Channel<T>, T];

interface DoAltsOptions {
  priority?: boolean;
  default?: undefined;
}

export function doAlts<T>(
  operations: Operation<T>[],
  callback: (result: AltResult<T | boolean |null | undefined>) => any,
  options: DoAltsOptions
): void {
  if (operations.length === 0) {
    throw new Error('Empty alt list');
  }

  const flag: Box<boolean> = new Box(true);
  const indexes: number[] = shuffle(range(0, operations.length));
  const hasPriority: boolean = !!(options && options.priority);
  let result: BoxType<T | boolean> | null = null;

  for (let i = 0; i < operations.length; i += 1) {
    const index = hasPriority ? i : indexes[i];
    const operation: Operation<T> = operations[index];
    let ch: Channel<T>;

    if (operation instanceof Channel) {
      ch = operation;
      result = ch.take(
        new AltHandler(flag, (value: any) => callback(new AltResult(value, ch)))
      );
    } else {
      ch = operation[0];
      result = ch.put(
        operation[1],
        new AltHandler(flag, (value: any) => callback(new AltResult(value, ch)))
      );
    }

    if (result) {
      callback(new AltResult(result.value, ch));
      break;
    }
  }

  if (!result && has(options, 'default') && flag.value) {
    flag.value = false;
    callback(new AltResult(options.default, DEFAULT));
  }
}

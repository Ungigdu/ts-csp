import { RingBuffer, ring } from './buffers';

const TASK_BATCH_SIZE: number = 1024;
const tasks: RingBuffer<Function> = ring(32);
let running: boolean = false;
let queued: boolean = false;

export function queueDispatcher(): void {
  if (!(queued && running)) {
    queued = true;

    // Note: TypeScript doesn't have a built-in setImmediate declaration without additional typings or
    // environments (like Node.js types). If you're working in a Node.js environment, you might need
    // to install @types/node for setImmediate to be recognized.
    setImmediate(() => {
      let count: number = 0;

      running = true;
      queued = false;

      while (count < TASK_BATCH_SIZE) {
        const task: Function | undefined = tasks.pop();

        if (task) {
          task();
          count += 1;
        } else {
          break;
        }
      }

      running = false;

      if (tasks.length > 0) {
        queueDispatcher();
      }
    });
  }
}

export function run(func: Function): void {
  tasks.unboundedUnshift(func);
  queueDispatcher();
}

export function queueDelay(func: Function, delay: number): void {
  setTimeout(func, delay);
}

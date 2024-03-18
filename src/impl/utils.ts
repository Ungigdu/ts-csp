import { run } from './dispatch';
import { RingBuffer } from './buffers';

export const taskScheduler = (func: Function, value: unknown): void => {
    run(() => func(value));
};

// TypeScript version of isReduced checks if v is an object and if it has the property '@@transducer/reduced'
export const isReduced = (v: any): boolean => !!v && !!v['@@transducer/reduced'];

// In TypeScript, we use the generic type T to denote the type of elements within the RingBuffer
export function flush<T>(
    channelBuffer: RingBuffer<T>,
    callback: (value: T | undefined) => void
): void {
    while (channelBuffer.length > 0) {
        const item = channelBuffer.pop();
        callback(item);
    }
}

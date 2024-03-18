function acopy<T>(
    src: Array<T>,
    srcStart: number,
    dest: Array<T>,
    destStart: number,
    len: number
): void {
    for (let count = 0; count < len; count += 1) {
        dest[destStart + count] = src[srcStart + count];
    }
}

export class RingBuffer<T> {
    head: number;
    tail: number;
    length: number;
    arr: Array<T | undefined>;

    constructor(
        head: number,
        tail: number,
        length: number,
        arr: Array<T | undefined>
    ) {
        this.head = head;
        this.tail = tail;
        this.length = length;
        this.arr = arr;
    }

    pop(): T | undefined {
        if (this.length !== 0) {
            const elem = this.arr[this.tail];

            this.arr[this.tail] = undefined;
            this.tail = (this.tail + 1) % this.arr.length;
            this.length -= 1;

            return elem;
        }

        return undefined;
    }

    unshift(element: T): void {
        this.arr[this.head] = element;
        this.head = (this.head + 1) % this.arr.length;
        this.length += 1;
    }

    unboundedUnshift(element: T): void {
        if (this.length + 1 === this.arr.length) {
            this.resize();
        }
        this.unshift(element);
    }

    resize(): void {
        const newArrSize = this.arr.length * 2;
        const newArr: Array<T | undefined> = new Array(newArrSize);

        if (this.tail < this.head) {
            acopy(this.arr, this.tail, newArr, 0, this.length);
            this.tail = 0;
            this.head = this.length;
            this.arr = newArr;
        } else if (this.tail > this.head) {
            acopy(this.arr, this.tail, newArr, 0, this.arr.length - this.tail);
            acopy(this.arr, 0, newArr, this.arr.length - this.tail, this.head);
            this.tail = 0;
            this.head = this.length;
            this.arr = newArr;
        } else if (this.tail === this.head) {
            this.tail = 0;
            this.head = 0;
            this.arr = newArr;
        }
    }

    cleanup(predicate: (value: T) => boolean): void {
        for (let i = this.length; i > 0; i -= 1) {
            const value = this.pop();

            if (value !== undefined && predicate(value)) {
                this.unshift(value);
            }
        }
    }
}

export function ring<T>(n: number): RingBuffer<T> {
    if (n <= 0) {
        throw new Error("Can't create a ring buffer of size 0");
    }

    return new RingBuffer<T>(0, 0, 0, new Array<T | undefined>(n));
}

export class FixedBuffer<T> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    isFull(): boolean {
        return this.buffer.length === this.n;
    }

    remove(): T | undefined {
        return this.buffer.pop();
    }

    add(item: T): void {
        this.buffer.unboundedUnshift(item);
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function fixed<T>(n: number): FixedBuffer<T> {
    return new FixedBuffer(ring<T>(n), n);
}

export class DroppingBuffer<T> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    isFull(): boolean {
        return false;
    }

    remove(): T | undefined {
        return this.buffer.pop();
    }

    add(item: T): void {
        if (this.buffer.length !== this.n) {
            this.buffer.unshift(item);
        }
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function dropping<T>(n: number): DroppingBuffer<T> {
    return new DroppingBuffer(ring<T>(n), n);
}

export class SlidingBuffer<T> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    isFull(): boolean {
        return false;
    }

    remove(): T | undefined {
        return this.buffer.pop();
    }

    add(item: T): void {
        if (this.buffer.length === this.n) {
            this.remove();
        }

        this.buffer.unshift(item);
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function sliding<T>(n: number): SlidingBuffer<T> {
    return new SlidingBuffer(ring<T>(n), n);
}
export const  NO_VALUE = "@@PromiseBuffer/NO_VALUE";
export type PromiseBufferType<T> = T | typeof NO_VALUE | null

export class PromiseBuffer<T> {
    value: PromiseBufferType<T>;

    
    static isUndelivered = (value: unknown) => NO_VALUE === value;

    constructor(value: PromiseBufferType<T> = NO_VALUE) {
        this.value = value;
    }

    isFull(): boolean {
        return false;
    }

    remove(): T | undefined {
        if(NO_VALUE === this.value || null === this.value){
            return undefined;
        }
        return this.value
    }

    add(item: T): void {
        if (PromiseBuffer.isUndelivered(this.value)) {
            this.value = item;
        }
    }

    closeBuffer(): void {
        if (PromiseBuffer.isUndelivered(this.value)) {
            this.value = null;
        }
    }

    count() {
        return PromiseBuffer.isUndelivered(this.value) ? 0 : 1;
    }
}

export function promise<T>(): PromiseBuffer<T> {
    return new PromiseBuffer<T>();
}

export type BufferType<T> =
    | FixedBuffer<T>
    | DroppingBuffer<T>
    | SlidingBuffer<T>
    | PromiseBuffer<T>;

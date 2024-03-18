import { BufferType, RingBuffer, ring } from "./buffers";
import { Box, PutBox } from "./boxes";
import { isReduced, flush, taskScheduler } from "./utils";
import { IHandler } from "./handlers";
import { Transformer } from "transducers.js";

export const MAX_DIRTY = 64;
export const MAX_QUEUE_SIZE = 1024;
export const CLOSED = null;

export type BoxType<T> = Box<T | null | undefined>;

export class Channel<T> {
    buf?: BufferType<T>;
    xform?: Transformer<any, any>;
    takes: RingBuffer<IHandler>;
    puts: RingBuffer<PutBox<T>>;
    dirtyPuts: number;
    dirtyTakes: number;
    closed: boolean;
    id?: string;

    constructor(
        takes: RingBuffer<IHandler>,
        puts: RingBuffer<PutBox<T>>,
        buf: BufferType<T> | null,
        xform?: Transformer<any, any>
    ) {
        if (buf) {
            this.buf = buf;
        }
        this.xform = xform || undefined;
        this.takes = takes;
        this.puts = puts;
        this.dirtyTakes = 0;
        this.dirtyPuts = 0;
        this.closed = false;
    }

    put(value: T, handler: IHandler): Box<boolean> | null {
        if (value === CLOSED) {
            throw new Error("Cannot put CLOSED on a channel.");
        }

        if (!handler.isActive()) {
            return null;
        }

        if (this.closed) {
            handler.commit();
            return new Box(false);
        }

        // Soak the value through the buffer first, even if there is a
        // pending taker. This way the step function has a chance to act on the
        // value.
        if (this.buf && !this.buf.isFull()) {
            handler.commit();
            const done = isReduced(this.xform?.["@@transducer/step"](this.buf, value));
            while (this.buf.count() > 0 && this.takes.length > 0) {
                const taker = this.takes.pop();
                if (taker?.isActive()) {
                    taskScheduler(taker.commit(), this.buf.remove());
                }
            }
            if (done) {
                this.close();
            }
            return new Box(true);
        }

        // Either the buffer is full, in which case there won't be any
        // pending takes, or we don't have a buffer, in which case this loop
        // fulfills the first of them that is active (note that we don't
        // have to worry about transducers here since we require a buffer
        // for that).
        while (this.takes.length > 0) {
            const taker = this.takes.pop();
            if (taker?.isActive()) {
                handler.commit();
                taskScheduler(taker.commit(), value);
                return new Box(true);
            }
        }

        // No buffer, full buffer, no pending takes. Queue this put now if blockable.
        if (this.dirtyPuts > MAX_DIRTY) {
            this.puts.cleanup((putter) => putter?.handler.isActive() || false);
            this.dirtyPuts = 0;
        } else {
            this.dirtyPuts += 1;
        }

        if (handler.isBlockable()) {
            if (this.puts.length >= MAX_QUEUE_SIZE) {
                throw new Error(
                    `No more than ${MAX_QUEUE_SIZE} pending puts are allowed on a single channel.`
                );
            }
            this.puts.unboundedUnshift(new PutBox(handler, value));
        }

        return null;
    }

    take(handler: IHandler): BoxType<T> | null {
        if (!handler.isActive()) {
            return null;
        }

        if (this.buf && this.buf.count() > 0) {
            handler.commit();
            const value = this.buf.remove();
            // We need to check pending puts here, other wise they won't
            // be able to proceed until their number reaches MAX_DIRTY
            while (this.puts.length > 0 && !this.buf.isFull()) {
                const putter = this.puts.pop();
                if (putter?.handler.isActive()) {
                    taskScheduler(putter.handler.commit(), true);
                    if (
                        isReduced(this.xform?.["@@transducer/step"](this.buf, putter.value))
                    ) {
                        this.close();
                    }
                }
            }
            return new Box(value);
        }

        // Either the buffer is empty, in which case there won't be any
        // pending puts, or we don't have a buffer, in which case this loop
        // fulfills the first of them that is active (note that we don't
        // have to worry about transducers here since we require a buffer
        // for that).
        while (this.puts.length > 0) {
            const putter = this.puts.pop();
            if (putter?.handler.isActive()) {
                handler.commit();
                taskScheduler(putter.handler.commit(), true);
                return new Box(putter.value);
            }
        }

        if (this.closed) {
            handler.commit();
            return new Box(CLOSED);
        }

        // No buffer, empty buffer, no pending puts. Queue this take now if blockable.
        if (this.dirtyTakes > MAX_DIRTY) {
            this.takes.cleanup(
                (_handler: IHandler | undefined) => _handler?.isActive() || false
            );
            this.dirtyTakes = 0;
        } else {
            this.dirtyTakes += 1;
        }

        if (handler.isBlockable()) {
            if (this.takes.length >= MAX_QUEUE_SIZE) {
                throw new Error(
                    `No more than ${MAX_QUEUE_SIZE} pending takes are allowed on a single channel.`
                );
            }
            this.takes.unboundedUnshift(handler);
        }
        return null;
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        if (this.buf) {
            this.xform?.["@@transducer/result"](this.buf);
            while (this.buf.count() > 0 && this.takes.length > 0) {
                const taker = this.takes.pop();
                if (taker?.isActive()) {
                    taskScheduler(taker.commit(), this.buf.remove());
                }
            }
        }

        flush(this.takes, (taker: IHandler | undefined) => {
            if (taker && taker.isActive()) {
                taskScheduler(taker.commit(), CLOSED);
            }
        });

        flush(this.puts, (putter: PutBox<T> | undefined) => {
            if (putter && putter.handler.isActive()) {
                taskScheduler(putter.handler.commit(), false);
            }
        });
    }

    isClosed(): boolean {
        return this.closed;
    }
}

const AddTransformer: Transformer<any, any> = {
    "@@transducer/init": () => {
        throw new Error("init not available");
    },
    "@@transducer/result": (v: unknown) => v,
    "@@transducer/step": (buffer: BufferType<any>, input: unknown) => {
        // Assuming buffer has an `add` method. Adapt as needed.
        buffer.add(input);
        return buffer;
    },
};

function defaultExceptionHandler(err: Error): typeof CLOSED {
    console.error("Error in channel transformer", err.stack);
    return CLOSED;
}

function handleEx<T>(
    buf: BufferType<T>,
    exHandler: ((error: Error) => any) | undefined,
    e: Error
): BufferType<T> {
    const def = (exHandler || defaultExceptionHandler)(e);
    if (def !== CLOSED) {
        // Assuming buf has an `add` method. Adapt as needed.
        buf.add(def);
    }
    return buf;
}

function handleException<T>(
    exHandler?: (error: Error) => unknown
): (xform: Transformer<any, any>) => Transformer<any, any> {
    return (xform: Transformer<any, any>): Transformer<any, any> => ({
        "@@transducer/step": (buffer: BufferType<T>, input: unknown) => {
            try {
                return xform["@@transducer/step"](buffer, input);
            } catch (e) {
                return handleEx(buffer, exHandler, e as Error);
            }
        },
        "@@transducer/result": (buffer: BufferType<T>) => {
            try {
                return xform["@@transducer/result"](buffer);
            } catch (e) {
                return handleEx(buffer, exHandler, e as Error);
            }
        },
        "@@transducer/init": ()=> {}
    });
}

export function chan<T>(
    buf?: BufferType<T> | null,
    xform?: (transformer: Transformer<any, any>) => Transformer<any, any>,
    exHandler?: (error: Error) => unknown
): Channel<T> {
    let newXForm: Transformer<any, any>;
    if (xform) {
        if (!buf) {
            throw new Error("Only buffered channels can use transducers");
        }
        newXForm = xform(AddTransformer);
    } else {
        newXForm = AddTransformer;
    }
    if (!buf) {
        buf = null;
    }
    return new Channel(
        ring(32),
        ring(32),
        buf,
        handleException(exHandler)(newXForm)
    );
}

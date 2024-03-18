import times from 'lodash/times';
import { Box } from './impl/boxes';
import { CLOSED } from './impl/channels';
import {
    take as _take,
    put,
    takeThenCallback as takeAsync,
    putThenCallback as putAsync,
    alts,
} from './impl/process';
import { go, chan } from './csp.core';
import { Channel } from './impl/channels';
import { IHandler } from './impl/handlers';
import { BufferType, ring } from './impl/buffers';
import { PutInstruction } from './impl/instruction';
import { Transformer } from "transducers.js";

export type BufferOrN<T> = BufferType<T> | number;

export function mapFrom<T>(f: Function, ch: Channel<T>): Channel<any> {
    return {
        isClosed() {
            return ch.isClosed();
        },
        close() {
            ch.close();
        },
        put(value: any, handler: IHandler) {
            return ch.put(value, handler);
        },
        take(handler: IHandler) {
            const result = ch.take({
                isActive() {
                    return handler.isActive();
                },
                commit() {
                    const takeCallback = handler.commit();
                    return (value: any) => takeCallback(value === CLOSED ? CLOSED : f(value));
                },
                isBlockable: function (): boolean {
                    throw true;
                }
            });

            if (result) {
                const value = result.value;
                return new Box(value === CLOSED ? CLOSED : f(value));
            }

            return null;
        },
        takes: ring(32),
        puts: ring(32),
        closed: false,
        dirtyPuts: 0,
        dirtyTakes: 0,
        xform: undefined,
    };
}

export function mapInto<T>(f: Function, ch: Channel<T>): Channel<any>{
    return {
        isClosed() {
            return ch.isClosed();
        },
        close() {
            ch.close();
        },
        put(value: any, handler: IHandler) {
            return ch.put(f(value), handler);
        },
        take(handler: IHandler) {
            return ch.take(handler);
        },
        takes: ring(32),
        puts: ring(32),
        closed: false,
        dirtyPuts: 0,
        dirtyTakes: 0,
        xform: undefined
    };
}

export function filterFrom<T>(p: Function, ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);

    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            if (value === CLOSED) {
                out.close();
                break;
            }

            if (p(value)) {
                yield put(out, value);
            }
        }
    });
    return out;
}

export function filterInto<T>(p: Function, ch: Channel<T>): Channel<T> {
    return {
        isClosed() {
            return ch.isClosed();
        },
        close() {
            ch.close();
        },
        put(value: any, handler: IHandler) {
            if (p(value)) {
                return ch.put(value, handler);
            }

            return new Box(!ch.isClosed());
        },
        take(handler: IHandler) {
            return ch.take(handler);
        },
        takes: ring(32),
        puts: ring(32),
        closed: false,
        dirtyPuts: 0,
        dirtyTakes: 0,
        xform: undefined
    };
}

export function removeFrom<T>(p: Function, ch: Channel<T>) {
    return filterFrom((value: any) => !p(value), ch);
}

export function removeInto<T>(p: Function, ch: Channel<T>) {
    return filterInto((value: any) => !p(value), ch);
}

function* mapcat<T, Tx>(f: Function, src: Channel<T>, dst: Channel<Tx>) {
    for (; ;) {
        const value: unknown = yield _take(src);
        if (value === CLOSED) {
            dst.close();
            break;
        } else {
            const seq = f(value);
            const length = seq.length;
            for (let i = 0; i < length; i += 1) {
                yield put(dst, seq[i]);
            }
            if (dst.isClosed()) {
                break;
            }
        }
    }
}

export function mapcatFrom<T, Tx>(f: Function, ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    go(mapcat, [f, ch, out]);
    return out;
}

export function mapcatInto<Tx, T>(f: Function, ch: Channel<Tx>, bufferOrN?: BufferOrN<T>) {
    const src = chan(bufferOrN);
    go(mapcat, [f, src, ch]);
    return src;
}

export function pipe<T, Tx>(src: Channel<T>, dst: Channel<Tx>, keepOpen: boolean = false) {
    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(src);
            if (value === CLOSED) {
                if (!keepOpen) {
                    dst.close();
                }
                break;
            }
            const rV: unknown = yield put(dst, value)
            if (!rV) {
                break;
            }
        }
    });
    return dst;
}

export function split<T>(p: Function, ch: Channel<T>, trueBufferOrN?: BufferOrN<T>, falseBufferOrN?: BufferOrN<T>) {
    const tch = chan(trueBufferOrN);
    const fch = chan(falseBufferOrN);
    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            if (value === CLOSED) {
                tch.close();
                fch.close();
                break;
            }
            yield put(p(value) ? tch : fch, value);
        }
    });
    return [tch, fch];
}

export function reduce<T>(f: Function, init: any, ch: Channel<T>) {
    return go(
        function* () {
            let result = init;
            for (; ;) {
                const value: unknown = yield _take(ch);

                if (value === CLOSED) {
                    return result;
                }

                result = f(result, value);
            }
        }
    );
}

export function onto<T>(ch: Channel<T>, coll: any[], keepOpen: boolean = false) {
    return go(function* () {
        const length = coll.length;
        // FIX: Should be a generic looping interface (for...in?)
        for (let i = 0; i < length; i += 1) {
            yield put(ch, coll[i]);
        }
        if (!keepOpen) {
            ch.close();
        }
    });
}

// TODO: Bounded?
export function fromColl(coll: any[]) {
    const ch = chan(coll.length);
    onto(ch, coll);
    return ch;
}

export function map<T>(f: Function, chs: Channel<T>[], bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    const length = chs.length;
    // Array holding 1 round of values
    const values = new Array(length);
    // TODO: Not sure why we need a size-1 buffer here
    const dchan = chan(1);
    // How many more items this round
    let dcount: number;
    // put callbacks for each channel
    const dcallbacks = new Array(length);
    const callback = (i: number) =>
        (value: unknown) => {
            values[i] = value;
            dcount -= 1;
            if (dcount === 0) {
                putAsync(dchan, values.slice(0));
            }
        };

    for (let i = 0; i < length; i += 1) {
        dcallbacks[i] = callback(i);
    }

    go(function* () {
        for (; ;) {
            dcount = length;
            // We could just launch n goroutines here, but for effciency we
            // don't
            for (let i = 0; i < length; i += 1) {
                try {
                    takeAsync(chs[i], dcallbacks[i]);
                } catch (e) {
                    // FIX: Hmm why catching here?
                    dcount -= 1;
                }
            }

            const _values: unknown[] = yield _take(dchan);
            for (let i = 0; i < length; i += 1) {
                if (_values[i] === CLOSED) {
                    out.close();
                    return;
                }
            }
            yield put(out, f(..._values));
        }
    });
    return out;
}

export function merge<T>(chs: Channel<T>[], bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    const actives = chs.slice(0);
    go(function* () {
        for (; ;) {
            if (actives.length === 0) {
                break;
            }
            const r: PutInstruction<T> = yield alts(actives);
            const value = r.value;
            if (value === CLOSED) {
                // Remove closed channel
                const i = actives.indexOf(r.channel);
                actives.splice(i, 1);
            } else {
                yield put(out, value);
            }
        }
        out.close();
    });
    return out;
}

export function into<T>(coll: any[], ch: Channel<T>) {
    const result = coll.slice(0);
    return reduce(
        (_result: any, item: any) => {
            _result.push(item);
            return _result;
        },
        result,
        ch
    );
}

export function take<T>(n: number, ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    go(function* () {
        for (let i = 0; i < n; i += 1) {
            const value: unknown = yield _take(ch);
            if (value === CLOSED) {
                break;
            }
            yield put(out, value);
        }
        out.close();
    });
    return out;
}

const NOTHING = {};

export function unique<T>(ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    let last = NOTHING;
    go(function* () {
        for (; ;) {
            const value: Object = yield _take(ch);
            if (value === CLOSED) {
                break;
            }
            if (value !== last) {
                last = value;
                yield put(out, value);
            }
        }
        out.close();
    });
    return out;
}


export function uniqueObj<T>(ch: Channel<T>, bufferOrN?: BufferOrN<T>, comparator: (a: any, b: any) => boolean = defaultComparator) {
    const out = chan(bufferOrN);
    let last: any;
    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            if (value === CLOSED) {
                break;
            }
            if (!comparator(last, value)) {
                last = value;
                yield put(out, value);
            }
        }
        out.close();
    });
    return out;
}

// Default comparator that handles both primitives and objects
function defaultComparator(a: any, b: any): boolean {
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
        return JSON.stringify(a) === JSON.stringify(b);
    } else {
        return a === b;
    }
}


export function partitionBy<T>(f: Function, ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    let part: unknown[] = [];
    let last = NOTHING;
    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            if (value === CLOSED) {
                if (part.length > 0) {
                    yield put(out, part);
                }
                out.close();
                break;
            } else {
                const newItem = f(value);
                if (newItem === last || last === NOTHING) {
                    part.push(value);
                } else {
                    yield put(out, part);
                    part = [value];
                }
                last = newItem;
            }
        }
    });
    return out;
}

export function partition<T>(n: number, ch: Channel<T>, bufferOrN?: BufferOrN<T>) {
    const out = chan(bufferOrN);
    go(function* () {
        for (; ;) {
            const part = new Array(n);
            for (let i = 0; i < n; i += 1) {
                const value: unknown = yield _take(ch);
                if (value === CLOSED) {
                    if (i > 0) {
                        yield put(out, part.slice(0, i));
                    }
                    out.close();
                    return;
                }
                part[i] = value;
            }
            yield put(out, part);
        }
    });
    return out;
}

// For channel identification
const genId = (() => {
    let i = 0;

    return () => {
        i += 1;
        return `${i}`;
    };
})();

function chanId<T>(ch: Channel<T>) {

    if (!ch.id) {
        const generatedId = genId();
        ch.id = generatedId;
    }

    return ch.id;
}

class Tap<T> {
    channel: Channel<T>;
    keepOpen: boolean;
    constructor(channel: Channel<T>, keepOpen: boolean = false) {
        this.channel = channel;
        this.keepOpen = keepOpen;
    }
}

class Mult<T> {
    taps: any;
    ch: any;
    constructor(ch: Channel<T>) {
        this.taps = {};
        this.ch = ch;
    }

    muxch() {
        return this.ch;
    }

    tap(ch: Channel<T>, keepOpen: boolean = false) {
        this.taps[chanId(ch)] = new Tap(ch, keepOpen);
    }

    untap(ch: Channel<T>) {
        delete this.taps[chanId(ch)];
    }

    untapAll() {
        this.taps = {};
    }
}

export function mult<T>(ch: Channel<T>) {
    const m = new Mult(ch);
    const dchan = chan(1);
    let dcount: number;

    function makeDoneCallback(tap: Tap<T>) {
        return (stillOpen: boolean) => {
            dcount -= 1;
            if (dcount === 0) {
                putAsync(dchan, true);
            }
            if (!stillOpen) {
                m.untap(tap.channel);
            }
        };
    }

    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            const taps = m.taps;
            let t;

            if (value === CLOSED) {
                Object.keys(taps).forEach(id => {
                    t = taps[id];
                    if (!t.keepOpen) {
                        t.channel.close();
                    }
                });

                // TODO: Is this necessary?
                m.untapAll();
                break;
            }
            dcount = Object.keys(taps).length;
            // XXX: This is because putAsync can actually call back
            // immediately. Fix that
            const initDcount = dcount;
            // Put value on tapping channels...
            Object.keys(taps).forEach(id => {
                t = taps[id];
                putAsync(t.channel, value, makeDoneCallback(t));
            });
            // ... waiting for all puts to complete
            if (initDcount > 0) {
                yield _take(dchan);
            }
        }
    });
    return m;
}

mult.tap = (m: any, ch: any, keepOpen: boolean = false) => {
    m.tap(ch, keepOpen);
    return ch;
};

mult.untap = (m: any, ch: any) => {
    m.untap(ch);
};

// mult.untapAll = m => {
//     m.untapAll();
// };

const MIX_MUTE = 'mute';
const MIX_PAUSE = 'pause';
const MIX_SOLO = 'solo';
const VALID_SOLO_MODES = [MIX_MUTE, MIX_PAUSE];

class Mix<T> {
    ch: any;
    stateMap: any;
    change: Channel<unknown>;
    soloMode: string;
    constructor(ch: Channel<T>) {
        this.ch = ch;
        this.stateMap = {};
        this.change = chan();
        this.soloMode = MIX_MUTE;
    }

    _changed() {
        putAsync(this.change, true);
    }

    _getAllState() {
        const stateMap = this.stateMap;
        const solos: any[] = [];
        const mutes: any = [];
        const pauses: any = [];
        let reads;

        Object.keys(stateMap).forEach(id => {
            const chanData = stateMap[id];
            const state = chanData.state;
            const channel = chanData.channel;
            if (state[MIX_SOLO]) {
                solos.push(channel);
            }
            // TODO
            if (state[MIX_MUTE]) {
                mutes.push(channel);
            }
            if (state[MIX_PAUSE]) {
                pauses.push(channel);
            }
        });

        let i;
        let n;
        if (this.soloMode === MIX_PAUSE && solos.length > 0) {
            n = solos.length;
            reads = new Array(n + 1);
            for (i = 0; i < n; i += 1) {
                reads[i] = solos[i];
            }
            reads[n] = this.change;
        } else {
            reads = [];
            Object.keys(stateMap).forEach(id => {
                const chanData = stateMap[id];
                const channel = chanData.channel;
                if (pauses.indexOf(channel) < 0) {
                    reads.push(channel);
                }
            });
            reads.push(this.change);
        }

        return { solos, mutes, reads };
    }

    admix<T>(ch: Channel<T>) {
        this.stateMap[chanId(ch)] = {
            channel: ch,
            state: {},
        };
        this._changed();
    }

    unmix<T>(ch: Channel<T>) {
        delete this.stateMap[chanId(ch)];
        this._changed();
    }

    unmixAll() {
        this.stateMap = {};
        this._changed();
    }

    toggle(updateStateList: any[]) {
        // [[ch1, {}], [ch2, {solo: true}]];
        const length = updateStateList.length;
        for (let i = 0; i < length; i += 1) {
            const ch = updateStateList[i][0];
            const id = chanId(ch);
            const updateState = updateStateList[i][1];
            let chanData = this.stateMap[id];

            if (!chanData) {
                const defaultVal = {
                    channel: ch,
                    state: {},
                };

                chanData = defaultVal;
                this.stateMap[id] = defaultVal;
            }
            Object.keys(updateState).forEach(mode => {
                chanData.state[mode] = updateState[mode];
            });
        }
        this._changed();
    }

    setSoloMode(mode: string) {
        if (VALID_SOLO_MODES.indexOf(mode) < 0) {
            throw new Error('Mode must be one of: '+ VALID_SOLO_MODES.join(', '));
        }
        this.soloMode = mode;
        this._changed();
    }
}

export function mix<T>(out: any) {
    const m = new Mix(out);
    go(function* () {
        let state = m._getAllState();

        for (; ;) {
            const result: PutInstruction<T> = yield alts(state.reads);
            const value = result.value;
            const channel = result.channel;

            if (value === CLOSED) {
                delete m.stateMap[chanId(channel)];
                state = m._getAllState();
            } else if (channel === m.change) {
                state = m._getAllState();
            } else {
                const solos = state.solos;

                if (
                    solos.indexOf(channel) > -1 ||
                    (solos.length === 0 && !(state.mutes.indexOf(channel) > -1))
                ) {
                    const stillOpen: boolean = yield put(out, value);
                    if (!stillOpen) {
                        break;
                    }
                }
            }
        }
    });
    return m;
}

mix.add = function admix<T>(m: Mix<T>, ch: Channel<T>) {
    m.admix(ch);
};

mix.remove = function unmix<T>(m: Mix<T>, ch: Channel<T>) {
    m.unmix(ch);
};

mix.removeAll = function unmixAll<T>(m: Mix<T>) {
    m.unmixAll();
};

mix.toggle = function toggle<T>(m: Mix<T>, updateStateList: any[]) {
    m.toggle(updateStateList);
};

mix.setSoloMode = function setSoloMode<T>(m: Mix<T>, mode: any) {
    m.setSoloMode(mode);
};

function constantlyNull() {
    return null;
}

class Pub<T> {
    ch: Channel<T>;
    topicFn: any;
    bufferFn: any;
    mults: any;
    constructor(ch: Channel<T>, topicFn: any, bufferFn: any) {
        this.ch = ch;
        this.topicFn = topicFn;
        this.bufferFn = bufferFn;
        this.mults = {};
    }

    _ensureMult(topic: any) {
        let m = this.mults[topic];
        const bufferFn = this.bufferFn;

        if (!m) {
            const defaultVal = mult(chan(bufferFn(topic)));

            m = defaultVal;
            this.mults[topic] = defaultVal;
        }
        return m;
    }

    sub(topic: any, ch: Channel<T>, keepOpen: boolean = false) {
        const m = this._ensureMult(topic);
        return mult.tap(m, ch, keepOpen);
    }

    unsub(topic: any, ch: Channel<T>) {
        const m = this.mults[topic];
        if (m) {
            mult.untap(m, ch);
        }
    }

    unsubAll(topic: any) {
        if (topic === undefined) {
            this.mults = {};
        } else {
            delete this.mults[topic];
        }
    }
}

export function pub<T>(ch: Channel<T>, topicFn: any, bufferFn = constantlyNull) {
    const p = new Pub(ch, topicFn, bufferFn);
    go(function* () {
        for (; ;) {
            const value: unknown = yield _take(ch);
            const mults = p.mults;
            if (value === CLOSED) {
                Object.keys(mults).forEach(topic => {
                    mults[topic].muxch().close();
                });
                break;
            }
            // TODO: Somehow ensure/document that this must return a string
            // (otherwise use proper (hash)maps)
            const topic = topicFn(value);
            const m = mults[topic];
            if (m) {
                const stillOpen: boolean = yield put(m.muxch(), value);
                if (!stillOpen) {
                    delete mults[topic];
                }
            }
        }
    });
    return p;
}

pub.sub = (p: Pub<unknown>, topic: unknown, ch: Channel<unknown>, keepOpen: boolean = false) => p.sub(topic, ch, keepOpen);

pub.unsub = (p: Pub<unknown>, topic: unknown, ch: Channel<unknown>) => {
    p.unsub(topic, ch);
};

pub.unsubAll = (p: Pub<unknown>, topic: unknown) => {
    p.unsubAll(topic);
};

function pipelineInternal<T, Tx>(n: number, to: Channel<Tx>, from: Channel<T>, close: boolean, taskFn: Function) {
    if (n <= 0) {
        throw new Error('n must be positive');
    }

    const jobs = chan(n);
    const results = chan(n);

    times(n, () => {
        go(
            function* (_taskFn: Function, _jobs: Channel<unknown>, _results: any) {
                for (; ;) {
                    const job: unknown = yield _take(_jobs);

                    if (!_taskFn(job)) {
                        _results.close();
                        break;
                    }
                }
            },
            [taskFn, jobs, results]
        );
    });

    go(
        function* (_jobs: Channel<unknown>, _from: Channel<T>, _results: any) {
            for (; ;) {
                const v: T = yield _take(_from);

                if (v === CLOSED) {
                    _jobs.close();
                    break;
                }

                const p = chan(1);

                yield put(_jobs, [v, p]);
                yield put(_results, p);
            }
        },
        [jobs, from, results]
    );

    go(
        function* (_results: any, _close: boolean, _to: Channel<Tx>) {
            for (; ;) {
                const p: Channel<unknown> = yield _take(_results);

                if (p === CLOSED) {
                    if (_close) {
                        _to.close();
                    }
                    break;
                }

                const res: Channel<unknown> = yield _take(p);

                for (; ;) {
                    const v: unknown = yield _take(res);

                    if (v === CLOSED) {
                        break;
                    }

                    yield put(_to, v);
                }
            }
        },
        [results, close, to]
    );

    return to;
}

export function pipeline<T, Tx>(to: Channel<Tx>, xf: (transformer: Transformer<any, any>) => Transformer<any, any>, from: Channel<T>, keepOpen: boolean = false, exHandler?: (error: Error) => any) {
    function taskFn(job: any) {
        if (job === CLOSED) {
            return null;
        }

        const [v, p] = job;
        const res = chan(1, xf, exHandler);

        go(
            function* (ch: Channel<unknown>, value: unknown) {
                yield put(ch, value);
                res.close();
            },
            [res, v]
        );

        putAsync(p, res);

        return true;
    }

    return pipelineInternal(1, to, from, !keepOpen, taskFn);
}

export function pipelineAsync<T, Tx>(n: number, to: Channel<Tx>, af: Function, from: Channel<T>, keepOpen: boolean = false) {
    function taskFn(job: any) {
        if (job === CLOSED) {
            return null;
        }

        const [v, p] = job;
        const res = chan(1);
        af(v, res);
        putAsync(p, res);

        return true;
    }

    return pipelineInternal(n, to, from, !keepOpen, taskFn);
}
// Possible "fluid" interfaces:

// thread(
//   [fromColl, [1, 2, 3, 4]],
//   [mapFrom, inc],
//   [into, []]
// )

// thread(
//   [fromColl, [1, 2, 3, 4]],
//   [mapFrom, inc, _],
//   [into, [], _]
// )

// wrap()
//   .fromColl([1, 2, 3, 4])
//   .mapFrom(inc)
//   .into([])
//   .unwrap();

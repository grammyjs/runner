/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

export type ModuleSpecifier = string | URL;

export interface Thread<I, O> {
    onMessage: (callback: (o: O) => void | Promise<void>) => void;
    postMessage: (i: I) => void | Promise<void>;
}

export interface Seed<S> {
    seed: Promise<S>;
}

export function createThread<I, O, S>(
    specifier: ModuleSpecifier,
    seed: S,
): Thread<I, O> {
    const url = new URL(specifier, import.meta.url);
    const worker = new Worker(url.href, { type: "module" });
    worker.postMessage(seed);
    return {
        onMessage(callback) {
            worker.onmessage = ({ data: o }: MessageEvent<O>) => callback(o);
        },
        postMessage(i) {
            worker.postMessage(i);
        },
    };
}

export function parentThread<O, I, S>(): Thread<O, I> & Seed<S> {
    let resolve: undefined | ((seed: S) => void) = undefined;
    return {
        seed: new Promise<S>((r) => resolve = r),
        onMessage(callback) {
            self.onmessage = ({ data }: MessageEvent<S>) => {
                resolve?.(data);
                self.onmessage = ({ data: i }: MessageEvent<I>) => callback(i);
            };
        },
        postMessage(o) {
            self.postMessage(o);
        },
    };
}

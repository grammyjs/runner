/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

export type ModuleSpecifier = string | URL;

export interface Thread<I, O> {
    onMessage: (callback: (o: O) => void | Promise<void>) => void;
    postMessage: (i: I) => void | Promise<void>;
}

export function createThread<I, O>(specifier: ModuleSpecifier): Thread<I, O> {
    const url = new URL(specifier, import.meta.url);
    const worker = new Worker(url.href, { type: "module" });
    return {
        onMessage(callback) {
            worker.onmessage = ({ data: o }: MessageEvent<O>) => callback(o);
        },
        postMessage(i) {
            worker.postMessage(i);
        },
    };
}

export function parentThread<O, I>(): Thread<O, I> {
    return {
        onMessage(callback) {
            self.onmessage = ({ data: i }: MessageEvent<I>) => callback(i);
        },
        postMessage(o) {
            self.postMessage(o);
        },
    };
}

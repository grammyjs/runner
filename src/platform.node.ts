import { parentPort, Worker } from "worker_threads";

export interface Thread<I, O> {
    onMessage: (callback: (i: I) => void | Promise<void>) => void;
    postMessage: (o: O) => void | Promise<void>;
}

export function createThread<I, O>(specifier: string | URL): Thread<O, I> {
    const worker = new Worker(specifier);
    return {
        onMessage(callback) {
            worker.on("message", callback);
        },
        postMessage(o) {
            worker.postMessage(o);
        },
    };
}

export function parentThread<I, O>(): Thread<I, O> {
    return {
        onMessage(callback) {
            parentPort.on("message", callback);
        },
        postMessage(o) {
            parentPort.postMessage(o);
        },
    };
}

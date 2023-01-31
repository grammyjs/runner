import { parentPort, Worker } from "worker_threads";

export type ModuleSpecifier = string;

export interface Thread<I, O> {
    onMessage: (callback: (o: O) => void | Promise<void>) => void;
    postMessage: (i: I) => void | Promise<void>;
}

export function createThread<I, O>(specifier: ModuleSpecifier): Thread<I, O> {
    const worker = new Worker(specifier);
    return {
        onMessage(callback) {
            worker.on("message", callback);
        },
        postMessage(i) {
            worker.postMessage(i);
        },
    };
}

export function parentThread<I, O>(): Thread<I, O> {
    return {
        onMessage(callback) {
            parentPort?.on("message", callback);
        },
        postMessage(o) {
            parentPort?.postMessage(o);
        },
    };
}

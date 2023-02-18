import { parentPort, Worker, workerData } from "worker_threads";

export type ModuleSpecifier = string;

export interface Thread<I, O> {
    onMessage: (callback: (o: O) => void | Promise<void>) => void;
    postMessage: (i: I) => void | Promise<void>;
}

interface Seed<S> {
    seed: Promise<S>;
}

export function createThread<I, O, S>(
    specifier: ModuleSpecifier,
    seed: S,
): Thread<I, O> {
    const worker = new Worker(specifier, { workerData: seed });
    return {
        onMessage(callback) {
            worker.on("message", callback);
        },
        postMessage(i) {
            worker.postMessage(i);
        },
    };
}

export function parentThread<I, O, S>(): Thread<I, O> & Seed<S> {
    return {
        seed: workerData,
        onMessage(callback) {
            parentPort?.on("message", callback);
        },
        postMessage(o) {
            parentPort?.postMessage(o);
        },
    };
}

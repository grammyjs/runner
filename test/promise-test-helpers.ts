import {
    assert as assert_,
    assertEquals as assertEquals_,
    assertThrows as assertThrows_,
} from "https://deno.land/std@0.87.0/testing/asserts.ts";

export interface T {
    pass: () => void;
    fail: () => void;
    sleep: (ms: number) => Promise<void>;
    assert: typeof assert_;
    assertThrows: typeof assertThrows_;
    assertEquals: typeof assertEquals_;
}

export function test(fn: (t: T) => void | Promise<void>): () => Promise<void> {
    return () =>
        new Promise(async (resolve, reject) => {
            function noThrow<X extends (...args: any[]) => any>(fn: X) {
                return (...args: any[]) => {
                    try {
                        return fn(...args);
                    } catch (error) {
                        reject(error);
                    }
                };
            }
            const t: T = {
                pass: resolve,
                fail: reject,
                sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                assertThrows: noThrow(assertThrows_),
                assert: noThrow(assert_),
                assertEquals: noThrow(assertEquals_),
            };
            await fn(t);
        });
}

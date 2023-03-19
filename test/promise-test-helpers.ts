import { deferred } from "https://deno.land/std@0.177.0/async/deferred.ts";
import {
    assert,
    assertEquals,
    assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

export interface T {
    pass: () => void;
    fail: () => void;
    sleep: (ms: number) => Promise<void>;
    assert: typeof assert;
    assertThrows: typeof assertThrows;
    assertEquals: typeof assertEquals;
}

export function test(fn: (t: T) => void | Promise<void>): () => Promise<void> {
    return async () => {
        const def = deferred();
        const t: T = {
            pass: () => def.resolve(),
            fail: () => def.reject(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            assertThrows: assertThrows,
            assert: assert,
            assertEquals: assertEquals,
        };
        try {
            await fn(t);
        } catch (error) {
            def.reject(error);
        }
        await def;
    };
}

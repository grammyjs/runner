import { DecayingDeque } from '../src/queue.ts'
import {
    assertThrows as assertThrows_,
    assertEquals as assertEquals_,
    assert as assert_,
} from 'https://deno.land/std@0.87.0/testing/asserts.ts'

interface T {
    pass: () => void
    fail: () => void
    assert: typeof assert_
    assertThrows: typeof assertThrows_
    assertEquals: typeof assertEquals_
}
function test(fn: (t: T) => void | Promise<void>): () => Promise<void> {
    return () =>
        new Promise(async (resolve, reject) => {
            function c<X extends (...args: any[]) => any>(fn: X) {
                return (...args: any[]) => {
                    try {
                        return fn(...args)
                    } catch (error) {
                        reject(error)
                    }
                }
            }
            const t: T = {
                pass: resolve,
                fail: reject,
                assertThrows: c(assertThrows_),
                assert: c(assert_),
                assertEquals: c(assertEquals_),
            }
            await fn(t)
        })
}

Deno.test(
    'should allow infinite timeouts',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            Infinity,
            async v => {
                res += v
            },
            false,
            () => t.fail(),
            () => t.fail()
        )
        await q.add(['a'])
        t.assertEquals(res, 'a')
        t.pass()
    })
)

Deno.test(
    'should process a single update',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            1000,
            async v => {
                res += v
            },
            false,
            () => t.fail(),
            () => t.fail()
        )
        await q.add(['a'])
        t.assertEquals(res, 'a')
        t.pass()
    })
)

Deno.test(
    'should process two updates in order',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            1000,
            async v => {
                res += v
            },
            false,
            () => t.fail(),
            () => t.fail()
        )
        await q.add(['a', 'b'])
        t.assertEquals(res, 'ab')
        t.pass()
    })
)

Deno.test(
    'should process updates from different calls',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            1000,
            async v => {
                res += v
            },
            false,
            () => t.fail(),
            () => t.fail()
        )
        await q.add(['a'])
        await q.add(['b'])
        t.assertEquals(res, 'ab')
        t.pass()
    })
)

Deno.test(
    'should create snapshots',
    test(async t => {
        const values = [...'abc']
        let r: () => void
        const promise = new Promise<void>(resolve => (r = resolve))
        const q = new DecayingDeque<string>(
            1000,
            () => promise,
            true,
            () => t.fail(),
            () => t.fail()
        )
        t.assertEquals(q.pendingTasks(), [])
        await q.add(values).then(() => r())
        t.assertEquals(q.pendingTasks(), values)
        await promise
        t.assertEquals(q.pendingTasks(), [])
        t.pass()
    })
)

Deno.test(
    'should process delayed updates from different calls',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            1000,
            async v => {
                res += v
            },
            false,
            () => t.fail(),
            () => t.fail()
        )
        await q.add(['a'])
        setTimeout(async () => {
            await q.add(['b'])
            t.assertEquals(res, 'ab')
            t.pass()
        }, 10)
    })
)

Deno.test(
    'should catch errors',
    test(async t => {
        const q = new DecayingDeque(
            1000,
            v => Promise.reject(v),
            false,
            (err, elem) => {
                t.assertEquals(err, 'a')
                t.assertEquals(elem, 'a')
                t.pass()
            },
            () => t.fail()
        )
        q.add(['a'])
    })
)

Deno.test(
    'should catch multiple errors',
    test(async t => {
        let res = ''
        const q = new DecayingDeque(
            1000,
            v => Promise.reject(v),
            false,
            (err, elem) => {
                if (
                    (err !== 'a' && err !== 'b') ||
                    (elem !== 'a' && elem !== 'b')
                )
                    t.fail()
                res += err
                if (res === 'ab') t.pass()
            },
            () => t.fail()
        )
        q.add(['a', 'b'])
    })
)

Deno.test(
    'should catch timeouts',
    test(async t => {
        const promise = new Promise<void>(() => {})
        const q = new DecayingDeque(
            10,
            () => promise,
            false,
            () => t.fail(),
            e => {
                t.assertEquals(e, 'a')
                t.pass()
            }
        )
        q.add(['a'])
    })
)

Deno.test(
    'should catch multiple timeouts',
    test(async t => {
        const promise = new Promise<void>(() => {})
        let res = ''
        const q = new DecayingDeque(
            10,
            () => promise,
            false,
            () => t.fail(),
            e => {
                if (e !== 'a' && e !== 'b') t.fail()
                res += e
                if (res === 'ab') t.pass()
            }
        )
        q.add(['a', 'b'])
    })
)

async function patternTest(t: T, pattern: string, expected = pattern) {
    // `res` collects the results of promises that resolve, reject, or time out,
    // and these events have to happen in the correct order,
    // otherwise `res` will be built up the wrong way from the given update pattern
    let res = ''
    const q = new DecayingDeque<string>(
        20,
        c => {
            if (c.match(/[a-z]/)) {
                // value
                return new Promise(resolve => {
                    setTimeout(() => {
                        res += c
                        resolve()
                    })
                })
            } else if (c.match(/[0-9]/)) {
                // error
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        reject(c)
                    })
                })
            } else {
                // timeout
                return new Promise(() => {})
            }
        },
        false,
        v => {
            res += v
        },
        v => (res += v)
    )
    await q.add([...pattern])
    t.assertEquals(res, expected)
    t.pass()
}

Deno.test(
    'should handle simple update patterns',
    test(t => patternTest(t, 'a'))
)
Deno.test(
    'should handle long value update patterns',
    test(t => patternTest(t, 'xxxxxxxxxx'))
)
Deno.test(
    'should handle long error update patterns',
    test(t => patternTest(t, '9999999999'))
)
Deno.test(
    'should handle long timeout update patterns',
    test(t => patternTest(t, '..........'))
)
Deno.test(
    'should handle combined update patterns',
    test(t => patternTest(t, 'x9.'))
)
Deno.test(
    'should handle mixed update patterns',
    test(t => patternTest(t, 'a9.b,', 'a9b.,'))
)
Deno.test(
    'should handle complex update patterns',
    test(t =>
        patternTest(
            t,
            'jadf.)(r45%4hj2h()$..x)=1kj5kfgg}]3567',
            'jadfr454hj2hx1kj5kfgg3567.)(%()$..)=}]'
        )
    )
)

Deno.test(
    'should return the correct capacity value for a single element',
    test(async t => {
        const q = new DecayingDeque(
            1000,
            () => Promise.resolve(),
            12,
            () => t.fail(),
            () => t.fail()
        )
        t.assertEquals(await q.add(['a']), 11)
        t.pass()
    })
)

Deno.test(
    'should return the correct capacity value for multiple elements',
    test(async t => {
        const q = new DecayingDeque(
            1000,
            () => Promise.resolve(),
            12,
            () => t.fail(),
            () => t.fail()
        )
        t.assertEquals(await q.add([...'abcd']), 8)
        t.pass()
    })
)

Deno.test(
    'should complete the add call as soon as there is capacity again',
    test(async t => {
        const q = new DecayingDeque(
            1000,
            () => Promise.resolve(),
            3,
            () => t.fail(),
            () => t.fail()
        )
        t.assertEquals(await q.add([...'abcdef']), 1)
        t.pass()
    })
)

Deno.test(
    'should decelerate add calls',
    test(async t => {
        const updates = new Array(1000).fill('x')
        const q = new DecayingDeque(
            20,
            () => new Promise(resolve => setTimeout(() => resolve())),
            1000,
            () => t.fail(),
            () => t.fail()
        )
        await updates.reduce(
            (p, v) =>
                p.then(() =>
                    q.add([v]).then(c => {
                        // we add a new element as soon as the previous `add` call resolves, and
                        // we expect that this only happens as soon as there is capacity,
                        // so we check that the capacity never falls below 1
                        if (c < 1) t.fail()
                    })
                ),
            Promise.resolve()
        )
        t.pass()
    })
)

Deno.test(
    'should resolve tasks after timing out',
    test(t => {
        let r: any
        const q = new DecayingDeque<string>(
            10,
            () => new Promise(resolve => (r = resolve)),
            false,
            () => t.fail(),
            (i, p) => {
                p.then(o => {
                    t.assertEquals(i, o)
                    t.pass()
                })
                r(i)
            }
        )
        q.add(['a'])
    })
)

Deno.test(
    'should rethrow errors for tasks that already timed out',
    test(t => {
        let r: any
        const q = new DecayingDeque(
            10,
            () => new Promise((resolve, reject) => (r = reject)),
            false,
            () => t.fail(),
            (i, p) => {
                p.catch(o => {
                    t.assertEquals(i, o)
                    t.pass()
                })
                r(i)
            }
        )
        q.add(['a'])
    })
)

Deno.test(
    'should handle concurrent add calls',
    test(t => {
        const r: Array<(value: void | PromiseLike<void>) => void> = []
        const q = new DecayingDeque(
            1000,
            () => new Promise(resolve => r.push(resolve)),
            3,
            () => t.fail(),
            () => t.fail()
        )
        let count = 0
        q.add([...'aaaaa']).then(() => ++count)
        q.add([...'bbbbb']).then(() => ++count)
        q.add([...'ccccc']).then(() => ++count)
        q.add([...'ddddd']).then(() => ++count)
        q.add([...'eeeee']).then(() => {
            t.assertEquals(++count, 5)
            t.pass()
        })
        r.forEach(f => f())
    })
)

Deno.test(
    'should purge many nodes after the same timeout',
    test(t => {
        let count = 0
        const updates = '0123456789'.repeat(10)
        const q = new DecayingDeque(
            5,
            () => new Promise(() => {}),
            false,
            () => t.fail(),
            () => count++
        )
        q.add([...updates])
        setTimeout(() => {
            t.assertEquals(count, updates.length)
            t.assertEquals(q.length, 0)
            t.pass()
        }, 20)
    })
)

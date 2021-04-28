import { sequentialize } from '../src/sequentialize.ts'
import { T, test } from './promise-test-helpers.ts'

const seq = () => sequentialize<string[]>(s => s)

Deno.test(
    'should call the middleware',
    test(async t => {
        const s = seq()
        await s(['p'], () => t.pass())
    })
)

Deno.test(
    'should handle failing middleware',
    test(async t => {
        const s = seq()
        await s(['p'], () => {
            throw 0
        }).catch(err => {
            t.assertEquals(err, 0)
            t.pass()
        })
    })
)

Deno.test({
    name: 'should allow unrelated updates to be executed concurrently',
    fn: test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        const p = s(['p'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['q'], async () => {
            await t.sleep(50)
            qx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(qx)
        await Promise.all([p, q])
        t.pass()
    }),
})

Deno.test(
    'should slow down updates',
    test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        const p = s(['p'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['p'], async () => {
            await t.sleep(50)
            qx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(!qx)
        await Promise.all([p, q])
        t.pass()
    })
)

Deno.test(
    'should work with several constraints',
    test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        const p = s(['a', 'b', 'c', 'd'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['a', 'b', 'c', 'd'], async () => {
            await t.sleep(50)
            qx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(!qx)
        await Promise.all([p, q])
        t.pass()
    })
)

Deno.test(
    'should work with several partially overlapping constraints',
    test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        const p = s(['a', 'b', 'c', 'd'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['c', 'e'], async () => {
            await t.sleep(50)
            qx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(!qx)
        await Promise.all([p, q])
        t.pass()
    })
)

Deno.test(
    'should respect old values',
    test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        let rx = false
        const p = s(['p'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['q'], async () => {
            await t.sleep(50)
            qx = true
        })
        await t.sleep(10)
        const r = s(['p'], async () => {
            await t.sleep(50)
            rx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(qx)
        t.assert(!rx)
        await Promise.all([p, q, r])
        t.pass()
    })
)

Deno.test(
    'should work with different previous dependencies',
    test(async (t: T) => {
        const s = seq()
        let px = false
        let qx = false
        let rx = false
        const p = s(['p'], async () => {
            await t.sleep(50)
            px = true
        })
        const q = s(['p', 'q'], async () => {
            await t.sleep(50)
            qx = true
        })
        const r = s(['p', 'q', 'r'], async () => {
            await t.sleep(50)
            rx = true
        })
        await t.sleep(75)
        t.assert(px)
        t.assert(!qx)
        t.assert(!rx)
        await t.sleep(50)
        t.assert(px)
        t.assert(qx)
        t.assert(!rx)
        await t.sleep(50)
        t.assert(px)
        t.assert(qx)
        t.assert(rx)
        await Promise.all([p, q, r])
        t.pass()
    })
)

Deno.test(
    'should pass the waterfall test',
    test(async (t: T) => {
        const s = seq()
        let ax = false
        let bx = false
        let cx = false
        let dx = false
        let ex = false
        let fx = false
        const a = s(['a'], async () => {
            await t.sleep(50)
            ax = true
        })
        const b = s(['a', 'b'], async () => {
            await t.sleep(50)
            bx = true
        })
        const c = s(['b', 'c'], async () => {
            await t.sleep(50)
            cx = true
        })
        const d = s(['c', 'd', 'a', 'b'], async () => {
            await t.sleep(50)
            dx = true
        })
        const e = s(['d', 'e'], async () => {
            await t.sleep(50)
            ex = true
        })
        const f = s(['e', 'f', 'c'], async () => {
            await t.sleep(50)
            fx = true
        })
        await t.sleep(75)
        t.assert(ax)
        t.assert(!bx)
        t.assert(!cx)
        t.assert(!dx)
        t.assert(!ex)
        t.assert(!fx)
        await t.sleep(50)
        t.assert(ax)
        t.assert(bx)
        t.assert(!cx)
        t.assert(!dx)
        t.assert(!ex)
        t.assert(!fx)
        await t.sleep(50)
        t.assert(ax)
        t.assert(bx)
        t.assert(cx)
        t.assert(!dx)
        t.assert(!ex)
        t.assert(!fx)
        await t.sleep(50)
        t.assert(ax)
        t.assert(bx)
        t.assert(cx)
        t.assert(dx)
        t.assert(!ex)
        t.assert(!fx)
        await t.sleep(50)
        t.assert(ax)
        t.assert(bx)
        t.assert(cx)
        t.assert(dx)
        t.assert(ex)
        t.assert(!fx)
        await t.sleep(50)
        t.assert(ax)
        t.assert(bx)
        t.assert(cx)
        t.assert(dx)
        t.assert(ex)
        t.assert(fx)
        await Promise.all([a, b, c, d, e, f])
        t.pass()
    })
)

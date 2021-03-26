export function sequentialize<C>(
    constraint: (ctx: C) => string | string[] | Promise<string | string[]>
) {
    const map = new Map<string, Promise<unknown>>()
    return async (ctx: C, next: () => Promise<void>) => {
        const con = await constraint(ctx)
        const cs = Array.isArray(con) ? con : [con]
        const immediate = Promise.resolve()
        const ps = cs
            .map(c => map.get(c) ?? immediate)
            .map(
                p => new Promise<void>(resolve => p.finally(resolve))
            )
        const collected = Promise.all(ps)
        cs.forEach(c => map.set(c, collected))
        await collected
        await next()
    }
}

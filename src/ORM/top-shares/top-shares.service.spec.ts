import { TOP_SHARES_PER_ADDRESS, TopSharesService } from './top-shares.service';

/** in-memory stand-in for the TypeORM repository, enough for find/insert/delete as the service uses them */
function fakeRepository() {
    let nextId = 1;
    const rows: any[] = [];
    const sortDesc = (list: any[]) => [...list].sort((a, b) => b.difficulty - a.difficulty);
    return {
        rows,
        insert: jest.fn(async (row: any) => { rows.push({ id: nextId++, ...row }); }),
        find: jest.fn(async (options: any) => {
            const filtered = options?.where?.address != null ? rows.filter(r => r.address === options.where.address) : rows;
            const sorted = sortDesc(filtered);
            return options?.take != null ? sorted.slice(0, options.take) : sorted;
        }),
        findOne: jest.fn(async (options: any) => sortDesc(rows.filter(r => r.address === options.where.address))[0] ?? null),
        delete: jest.fn(async (ids: number[]) => {
            for (const id of ids) {
                const index = rows.findIndex(r => r.id === id);
                if (index >= 0) rows.splice(index, 1);
            }
        }),
    };
}

describe('TopSharesService', () => {
    const share = (difficulty: number, address = 'bc1qa') => ({ address, worker: 'w', sessionId: 'abcd1234', userAgent: 'bitaxe', difficulty, time: 1 });

    it('records the first shares of an address and skips zero difficulty', async () => {
        const repo = fakeRepository();
        const service = new TopSharesService(repo as any);
        expect(await service.maybeRecord(share(0))).toBe(false);
        expect(await service.maybeRecord(share(100))).toBe(true);
        expect(await service.maybeRecord(share(50))).toBe(true);
        expect(repo.rows).toHaveLength(2);
    });

    it('keeps only the top list per address and ignores shares below the threshold', async () => {
        const repo = fakeRepository();
        const service = new TopSharesService(repo as any);
        for (let i = 1; i <= TOP_SHARES_PER_ADDRESS; i++) {
            await service.maybeRecord(share(i * 10));
        }
        expect(repo.rows).toHaveLength(TOP_SHARES_PER_ADDRESS);
        const inserts = repo.insert.mock.calls.length;
        // below the 25th best (10): no database write at all
        expect(await service.maybeRecord(share(5))).toBe(false);
        expect(repo.insert.mock.calls.length).toBe(inserts);
        // a better share replaces the weakest
        expect(await service.maybeRecord(share(999))).toBe(true);
        expect(repo.rows).toHaveLength(TOP_SHARES_PER_ADDRESS);
        expect(repo.rows.some(r => r.difficulty === 10)).toBe(false);
        expect((await service.bestForAddress('bc1qa')).difficulty).toBe(999);
        // another address has its own list
        expect(await service.maybeRecord(share(1, 'bc1qb'))).toBe(true);
        expect((await service.overall(1))[0].difficulty).toBe(999);
    });
});

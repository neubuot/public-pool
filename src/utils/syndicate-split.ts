/**
 * Syndicate mode: the Doichain block reward is split between the members in proportion to the share work
 * they contributed inside the payout window. Pure arithmetic, the service feeds it the weights.
 */

export interface SyndicateWeight {
    address: string;
    /** sum of share difficulty inside the window */
    work: number;
}

export interface SyndicatePayout {
    address: string;
    work: number;
    /** share of the reward, 0..1 */
    percent: number;
    /** integer coin units (1e-8 DOI) */
    amount: number;
}

export interface SplitOptions {
    /** outputs below this many units are dropped, their weight goes to the others */
    minPayout: number;
    /** at most this many outputs, the smallest contributors are dropped first */
    maxMembers: number;
}

/**
 * Distributes `reward` units over the weights. Members with no work, beyond the member cap or below the
 * minimum payout are left out and the rest is split again, so the full reward is always paid out.
 * Rounding dust goes to the largest contributor.
 */
export function splitReward(weights: SyndicateWeight[], reward: number, options: SplitOptions): SyndicatePayout[] {
    if (!(reward > 0)) {
        return [];
    }
    const maxMembers = Math.max(1, Math.floor(options.maxMembers));
    const minPayout = Math.max(0, Math.floor(options.minPayout));

    // one entry per address, largest first (ties by address so the order is stable)
    const merged = new Map<string, number>();
    for (const weight of weights) {
        if (weight == null || typeof weight.address !== 'string' || weight.address.length === 0 || !(weight.work > 0) || !Number.isFinite(weight.work)) {
            continue;
        }
        merged.set(weight.address, (merged.get(weight.address) ?? 0) + weight.work);
    }
    let members = Array.from(merged.entries())
        .map(([address, work]) => ({ address, work }))
        .sort((a, b) => b.work - a.work || (a.address < b.address ? -1 : 1))
        .slice(0, maxMembers);

    while (members.length > 0) {
        const total = members.reduce((acc, m) => acc + m.work, 0);
        const payouts = members.map(m => ({ address: m.address, work: m.work, percent: m.work / total, amount: Math.floor(reward * m.work / total) }));
        const kept = payouts.filter(p => p.amount >= minPayout && p.amount > 0);
        if (kept.length === payouts.length) {
            const paid = payouts.reduce((acc, p) => acc + p.amount, 0);
            payouts[0].amount += reward - paid;
            return payouts;
        }
        if (kept.length === 0) {
            // everything below the minimum: the largest contributor takes the whole reward
            members = members.slice(0, 1);
            continue;
        }
        members = members.filter(m => kept.some(k => k.address === m.address));
    }
    return [];
}

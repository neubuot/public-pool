import { plainToInstance } from 'class-transformer';

import { AuthorizationMessage } from './AuthorizationMessage';

describe('AuthorizationMessage', () => {
    it('should parse address, worker, and starting difficulty', () => {
        const message = plainToInstance(
            AuthorizationMessage,
            JSON.parse('{"id":3,"method":"mining.authorize","params":["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.worker1","x,d=2048"]}')
        );

        expect(message.address).toBe('tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4');
        expect(message.worker).toBe('worker1');
        expect(message.password).toBe('x,d=2048');
        expect(message.startingDiff).toBe(2048);
    });

    it('should default worker name when one is not provided', () => {
        const message = plainToInstance(
            AuthorizationMessage,
            JSON.parse('{"id":3,"method":"mining.authorize","params":["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4","x"]}')
        );

        expect(message.worker).toBe('worker');
        expect(message.startingDiff).toBeNull();
    });

    it('should ignore malformed starting difficulty hints', () => {
        const message = plainToInstance(
            AuthorizationMessage,
            JSON.parse('{"id":3,"method":"mining.authorize","params":["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.worker1","x,d=abc"]}')
        );

        expect(message.startingDiff).toBeNull();
    });

    it('should build successful authorization responses', () => {
        const message = plainToInstance(
            AuthorizationMessage,
            JSON.parse('{"id":3,"method":"mining.authorize","params":["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.worker1","x"]}')
        );

        expect(message.response()).toEqual({
            id: 3,
            error: null,
            result: true
        });
    });
});

describe('AuthorizationMessage syndicate flag', () => {
    const parse = (password: string) => plainToInstance(
        AuthorizationMessage,
        JSON.parse(JSON.stringify({ id: 3, method: 'mining.authorize', params: ['tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.worker1', password] }))
    );

    it('is off by default and with a bare Doichain address', () => {
        expect(parse('x').syndicate).toBe(false);
        const message = parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w');
        expect(message.syndicate).toBe(false);
        expect(message.doiAddress).toBe('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w');
    });

    it('accepts the syndicate word after the address, combined with a difficulty', () => {
        const message = parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,syndicate,d=512');
        expect(message.syndicate).toBe(true);
        expect(message.doiAddress).toBe('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w');
        expect(message.startingDiff).toBe(512);
        expect(parse('doi=dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,Syndikat').syndicate).toBe(true);
        expect(parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w syn').syndicate).toBe(true);
        expect(parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,s=1').syndicate).toBe(true);
    });

    it('ignores look-alikes', () => {
        expect(parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,s=0').syndicate).toBe(false);
        expect(parse('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,syndicates').syndicate).toBe(false);
    });
});

describe('AuthorizationMessage syndicate word in the user name', () => {
    const parse = (user: string, password = 'dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w') => plainToInstance(
        AuthorizationMessage,
        JSON.parse(JSON.stringify({ id: 3, method: 'mining.authorize', params: [user, password] }))
    );

    it('switches syndicate mode on and keeps the worker name clean', () => {
        const message = parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.nerdminer2lh,syndicate');
        expect(message.syndicate).toBe(true);
        expect(message.address).toBe('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r');
        expect(message.worker).toBe('nerdminer2lh');
        expect(message.doiAddress).toBe('dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w');
    });

    it('accepts the other spellings and separators', () => {
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.axe1;Syndikat').worker).toBe('axe1');
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.axe1 syn').syndicate).toBe(true);
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.axe1,s=1').syndicate).toBe(true);
    });

    it('works without a worker name', () => {
        const message = parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r,syndicate');
        expect(message.syndicate).toBe(true);
        expect(message.address).toBe('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r');
        expect(message.worker).toBe('worker');
    });

    it('leaves user names without the word exactly as they are', () => {
        const message = parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.my axe,2');
        expect(message.syndicate).toBe(false);
        expect(message.worker).toBe('my axe,2');
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.syndicate').syndicate).toBe(false);
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.syndicate').worker).toBe('syndicate');
        expect(parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.axe,s=0').syndicate).toBe(false);
    });

    it('still reads the word from the password', () => {
        const message = parse('bc1q4e0zx4afrmzqy2shuq9pypqky6junwwktzax9r.axe1', 'dc1qqf79wlchwd2jxpe3674h30xqsfypy7dr3hze6w,syndicate');
        expect(message.syndicate).toBe(true);
        expect(message.worker).toBe('axe1');
    });
});

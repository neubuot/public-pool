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

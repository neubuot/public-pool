import { BadRequestException, Controller, Get, Param } from '@nestjs/common';

import { SyndicateService } from '../../services/syndicate.service';

/** Syndicate mode: statistics, the current distribution, the block being mined and the payout history. */
@Controller('syndicate')
export class SyndicateController {

    constructor(
        private readonly syndicateService: SyndicateService,
    ) { }

    @Get()
    public async detail() {
        return await this.syndicateService.detail();
    }

    /** All payouts of one syndicate block. */
    @Get('block/:height')
    public async block(@Param('height') heightParam: string) {
        const height = parseInt(heightParam, 10);
        if (!Number.isInteger(height) || height < 0) {
            throw new BadRequestException('Keine Blockhöhe');
        }
        return { height, payouts: await this.syndicateService.payoutsForBlock(height) };
    }
}

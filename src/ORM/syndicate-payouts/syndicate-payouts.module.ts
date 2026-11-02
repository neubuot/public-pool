import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SyndicatePayoutEntity } from './syndicate-payout.entity';
import { SyndicatePayoutsService } from './syndicate-payouts.service';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([SyndicatePayoutEntity])],
    providers: [SyndicatePayoutsService],
    exports: [TypeOrmModule, SyndicatePayoutsService],
})
export class SyndicatePayoutsModule { }

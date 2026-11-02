import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SyndicateShareEntity } from './syndicate-share.entity';
import { SyndicateSharesService } from './syndicate-shares.service';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([SyndicateShareEntity])],
    providers: [SyndicateSharesService],
    exports: [TypeOrmModule, SyndicateSharesService],
})
export class SyndicateSharesModule { }

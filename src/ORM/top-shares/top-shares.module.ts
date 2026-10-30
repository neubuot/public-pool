import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TopShareEntity } from './top-share.entity';
import { TopSharesService } from './top-shares.service';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([TopShareEntity])],
    providers: [TopSharesService],
    exports: [TypeOrmModule, TopSharesService],
})
export class TopSharesModule { }

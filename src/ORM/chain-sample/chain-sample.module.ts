import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainSampleEntity } from './chain-sample.entity';
import { ChainSampleService } from './chain-sample.service';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([ChainSampleEntity])],
    providers: [ChainSampleService],
    exports: [TypeOrmModule, ChainSampleService],
})
export class ChainSampleModule { }

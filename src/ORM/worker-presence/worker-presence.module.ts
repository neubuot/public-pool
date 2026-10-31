import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkerPresenceEntity } from './worker-presence.entity';
import { WorkerPresenceService } from './worker-presence.service';


@Global()
@Module({
    imports: [TypeOrmModule.forFeature([WorkerPresenceEntity])],
    providers: [WorkerPresenceService],
    exports: [TypeOrmModule, WorkerPresenceService],
})
export class WorkerPresenceModule { }

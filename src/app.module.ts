import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AddressController } from './controllers/address/address.controller';
import { ClientController } from './controllers/client/client.controller';
import { BitcoinAddressValidator } from './models/validators/bitcoin-address.validator';
import { AddressSettingsModule } from './ORM/address-settings/address-settings.module';
import { BlocksModule } from './ORM/blocks/blocks.module';
import { ClientStatisticsModule } from './ORM/client-statistics/client-statistics.module';
import { ClientModule } from './ORM/client/client.module';
import { RpcBlocksModule } from './ORM/rpc-block/rpc-block.module';
import { TelegramSubscriptionsModule } from './ORM/telegram-subscriptions/telegram-subscriptions.module';
import { AppService } from './services/app.service';
import { BitcoinRpcService } from './services/bitcoin-rpc.service';
import { BraiinsService } from './services/braiins.service';
import { DoichainRpcService } from './services/doichain-rpc.service';
import { BTCPayService } from './services/btc-pay.service';
import { DiscordService } from './services/discord.service';
import { NotificationService } from './services/notification.service';
import { StratumV1JobsService } from './services/stratum-v1-jobs.service';
import { StratumV1Service } from './services/stratum-v1.service';
import { TelegramService } from './services/telegram.service';
import { ExternalSharesService } from './services/external-shares.service';
import { ExternalShareController } from './controllers/external-share/external-share.controller';
import { ExternalSharesModule } from './ORM/external-shares/external-shares.module';
import { ChainSampleModule } from './ORM/chain-sample/chain-sample.module';
import { ChainStatsService } from './services/chain-stats.service';
import { ExplorerService } from './services/explorer.service';
import { PoolEventsService } from './services/pool-events.service';
import { StatsController } from './controllers/stats/stats.controller';
import { ExplorerController } from './controllers/explorer/explorer.controller';
import { MinerController } from './controllers/miner/miner.controller';
import { ValidateController } from './controllers/validate/validate.controller';
import { TopSharesModule } from './ORM/top-shares/top-shares.module';
import { ShareImageService } from './services/share-image.service';
import { ShareController } from './controllers/share/share.controller';

const ORMModules = [
    ClientStatisticsModule,
    ClientModule,
    AddressSettingsModule,
    TelegramSubscriptionsModule,
    BlocksModule,
    RpcBlocksModule,
    ExternalSharesModule,
    ChainSampleModule,
    TopSharesModule
]

@Module({
    imports: [
        ConfigModule.forRoot(),
        TypeOrmModule.forRoot({
            type: 'sqlite',
            database: './DB/public-pool.sqlite',
            synchronize: true,
            autoLoadEntities: true,
            logging: false,
            enableWAL: true,
            busyTimeout: 30 * 1000,

        }),
        CacheModule.register(),
        ScheduleModule.forRoot(),
        HttpModule,
        ...ORMModules
    ],
    controllers: [
        AppController,
        ClientController,
        AddressController,
        ExternalShareController,
        StatsController,
        ExplorerController,
        MinerController,
        ValidateController,
        ShareController
    ],
    providers: [
        PoolEventsService,
        ChainStatsService,
        ExplorerService,
        ShareImageService,
        DiscordService,
        AppService,
        StratumV1Service,
        TelegramService,
        BitcoinRpcService,
        DoichainRpcService,
        NotificationService,
        BitcoinAddressValidator,
        StratumV1JobsService,
        BTCPayService,
        BraiinsService,
        ExternalSharesService,
    ],
})
export class AppModule {
    constructor() {

    }
}

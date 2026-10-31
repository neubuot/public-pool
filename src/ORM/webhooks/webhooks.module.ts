import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WebhookEntity } from './webhook.entity';
import { WebhooksService } from './webhooks.service';


@Global()
@Module({
    imports: [TypeOrmModule.forFeature([WebhookEntity])],
    providers: [WebhooksService],
    exports: [TypeOrmModule, WebhooksService],
})
export class WebhooksModule { }

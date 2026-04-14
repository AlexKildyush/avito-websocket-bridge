import { Global, Module } from '@nestjs/common';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

@Global()
@Module({
  providers: [MessagesGateway, MessagesService],
  exports: [MessagesGateway, MessagesService],
})
export class MessagesModule {}

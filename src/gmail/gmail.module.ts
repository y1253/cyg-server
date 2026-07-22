import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller.js';
import { GmailService } from './gmail.service.js';
import { MessageStateModule } from '../communications/message-state.module.js';

@Module({
  imports: [MessageStateModule],
  controllers: [GmailController],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}

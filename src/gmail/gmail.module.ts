import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller.js';
import { GmailService } from './gmail.service.js';

@Module({
  controllers: [GmailController],
  providers: [GmailService],
})
export class GmailModule {}

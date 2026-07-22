import { Module } from '@nestjs/common';
import { MicrosoftController } from './microsoft.controller.js';
import { MicrosoftService } from './microsoft.service.js';
import { MessageStateModule } from '../communications/message-state.module.js';

@Module({
  imports: [MessageStateModule],
  controllers: [MicrosoftController],
  providers: [MicrosoftService],
  exports: [MicrosoftService],
})
export class MicrosoftModule {}

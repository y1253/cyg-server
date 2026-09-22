import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiDocumentService } from './ai-document.service.js';

@Module({
  controllers: [AiController],
  providers: [AiService, AiDocumentService],
  exports: [AiService, AiDocumentService],
})
export class AiModule {}

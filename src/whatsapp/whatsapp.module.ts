import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppPublicController } from './whatsapp-public.controller.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppGraphService } from './whatsapp-graph.service.js';
import { WhatsAppMessagesService } from './whatsapp-messages.service.js';

/**
 * WhatsApp Cloud API: one connected number per company, messages persisted from the
 * webhook, surfaced in the Communications tab beside email, chat, calls and SMS.
 *
 * Exports the messages service for CommunicationsModule (dashboard counts + the bell).
 * Imports nothing but the global PrismaModule, so it stays a leaf — no cycle with the
 * communications gateway that depends on it.
 */
@Module({
  controllers: [WhatsAppController, WhatsAppPublicController],
  providers: [
    WhatsAppGraphService,
    WhatsAppAccountService,
    WhatsAppMessagesService,
  ],
  exports: [WhatsAppMessagesService],
})
export class WhatsAppModule {}

import { Module } from '@nestjs/common';
import { PhoneModule } from '../phone/phone.module.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppProvisioningService } from './whatsapp-provisioning.service.js';
import { WhatsAppPublicController } from './whatsapp-public.controller.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppGraphService } from './whatsapp-graph.service.js';
import { WhatsAppMessagesService } from './whatsapp-messages.service.js';

/**
 * WhatsApp Cloud API: one connected number per company, messages persisted from the
 * webhook, surfaced in the Communications tab beside email, chat, calls and SMS.
 *
 * Exports the messages service for CommunicationsModule (dashboard counts + the bell).
 *
 * Imports PhoneModule for "Generate WhatsApp account", which reads Meta's verification
 * text off the support number (`PhoneEventsService.smsReceived$`, and `SignalWireService`
 * for the sweep). One-way: PhoneModule imports nothing WhatsApp, so there is no cycle.
 */
@Module({
  imports: [PhoneModule],
  controllers: [WhatsAppController, WhatsAppPublicController],
  providers: [
    WhatsAppGraphService,
    WhatsAppAccountService,
    WhatsAppMessagesService,
    WhatsAppProvisioningService,
  ],
  exports: [WhatsAppMessagesService],
})
export class WhatsAppModule {}

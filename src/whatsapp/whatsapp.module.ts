import { Module } from '@nestjs/common';
import { PhoneModule } from '../phone/phone.module.js';
import { AiModule } from '../ai/ai.module.js';
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
 * code off the support number — by text (`PhoneEventsService.smsReceived$`) or, when Meta
 * cannot deliver a text, off a RECORDING of the call it places instead
 * (`voiceCodeRecorded$`, plus `SignalWireService` for both sweeps). One-way: PhoneModule
 * imports nothing WhatsApp, so there is no cycle.
 *
 * AiModule transcribes that recording. Deliberately NOT gated on `PHONE_SUMMARIZE_CALLS`:
 * that flag governs per-call spend and sending a CLIENT's recorded conversation to OpenAI,
 * while this is one admin-triggered, ~15-second recording of Meta's own robot. Gating it
 * would make the feature fail silently on every host where summaries are off — the exact
 * trap voicemail fell into by shipping inert with no switch anybody could find.
 */
@Module({
  imports: [PhoneModule, AiModule],
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

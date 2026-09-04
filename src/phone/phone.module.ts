import { Module } from '@nestjs/common';
import { MessageStateModule } from '../communications/message-state.module.js';
import { PhoneSettingsModule } from '../phone-settings/phone-settings.module.js';
import { PhoneAudioModule } from '../phone-audio/phone-audio.module.js';
import { PhoneController } from './phone.controller.js';
import { PhoneWebhooksController } from './phone-webhooks.controller.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { SignalWireService } from './signalwire.service.js';
import { CallRoutingService } from './call-routing.service.js';
import { PhoneEventsService } from './phone-events.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneDialerService } from './phone-dialer.service.js';
import { CallSummaryService } from './call-summary.service.js';
import { AiModule } from '../ai/ai.module.js';

/**
 * Imports only MessageStateModule; PrismaModule and ConfigModule are global.
 *
 * MessageStateModule is the provider-agnostic read/completed state used by the
 * mailbox. Calls and SMS reuse it verbatim with namespaced ids, which is what keeps
 * `SupportNumber` the only table this feature adds.
 *
 * Exports PhoneProvisioningService because CompaniesModule injects it to auto-provision
 * a number at registration. The dependency runs one way only — nothing here knows about
 * CompaniesService — so there is no cycle.
 */
@Module({
  // PhoneSettingsModule supplies the hours and caller-facing messages the inbound webhook
  // reads. One-way: phone-settings knows nothing about this module, so there is no cycle.
  // AiModule supplies the OpenAI round-trips CallSummaryService needs. It imports
  // nothing itself, so there is no cycle.
  imports: [
    MessageStateModule,
    PhoneSettingsModule,
    PhoneAudioModule,
    AiModule,
  ],
  // PhoneWebhooksController is UNAUTHENTICATED (SignalWire cannot present a JWT) and
  // verifies request signatures instead. Kept a separate class from PhoneController,
  // which is entirely JWT-guarded, so the two auth models never blur together.
  controllers: [PhoneController, PhoneWebhooksController],
  providers: [
    SignalWireService,
    PhoneProvisioningService,
    CallRoutingService,
    PhoneEventsService,
    PhoneTimelineService,
    PhoneDialerService,
    CallSummaryService,
  ],
  // SignalWireService and PhoneEventsService are exported for InternalCallsModule
  // (staff-to-staff calling), which originates calls and pushes the same SSE events.
  // PhoneTimelineService is exported for CommunicationsModule, whose cross-company
  // uncompleted-counts map now includes the phone contribution.
  // One-way: nothing here imports either module, so there is no cycle.
  exports: [
    PhoneProvisioningService,
    SignalWireService,
    PhoneEventsService,
    PhoneTimelineService,
    // Exported for InternalCallsModule, whose recordings route shows the same summary.
    CallSummaryService,
  ],
})
export class PhoneModule {}

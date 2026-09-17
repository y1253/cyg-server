import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module.js';
import { InternalMessagesModule } from '../internal-messages/internal-messages.module.js';
import { InternalCallsModule } from '../internal-calls/internal-calls.module.js';
import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { PhoneModule } from '../phone/phone.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { CommunicationsController } from './communications.controller.js';
import { MessageStateModule } from './message-state.module.js';
import { OutboundCleanupService } from './outbound-cleanup.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { UnreadFeedService } from './unread-feed.service.js';

/**
 * Gateway module for provider-agnostic Communications concerns: the cross-company
 * unified counts controller and the provider resolver. Imports both provider modules
 * (which export their services), plus PhoneModule for the phone half of the counts
 * map, and MessageStateModule for the batched "complete till here" write. That module is
 * dependency-free by design (only the global PrismaService), so importing it here adds no
 * cycle — which is the same property that lets both provider modules depend on it.
 * PhoneModule is likewise one-way — it knows nothing of this module.
 */
@Module({
  imports: [
    GmailModule,
    MicrosoftModule,
    InternalMessagesModule,
    InternalCallsModule,
    PhoneModule,
    WhatsAppModule,
    // "Complete till here" writes the shared completed state directly for email, chat
    // and SMS — they all live in one table, so one batched `flushCompleted` serves all
    // three rather than three per-provider routes.
    MessageStateModule,
  ],
  controllers: [CommunicationsController],
  providers: [
    ProviderResolverService,
    UnreadFeedService,
    OutboundCleanupService,
  ],
  exports: [ProviderResolverService],
})
export class CommunicationsModule {}

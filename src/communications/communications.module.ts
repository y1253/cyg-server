import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module.js';
import { InternalMessagesModule } from '../internal-messages/internal-messages.module.js';
import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { CommunicationsController } from './communications.controller.js';
import { OutboundCleanupService } from './outbound-cleanup.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';

/**
 * Gateway module for provider-agnostic Communications concerns: the cross-company
 * unified counts controller and the provider resolver. Imports both provider modules
 * (which export their services). The base MessageStateModule stays separate so the
 * provider modules can depend on it without a cycle.
 */
@Module({
  imports: [GmailModule, MicrosoftModule, InternalMessagesModule],
  controllers: [CommunicationsController],
  providers: [ProviderResolverService, OutboundCleanupService],
  exports: [ProviderResolverService],
})
export class CommunicationsModule {}

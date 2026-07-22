import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module.js';
import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { CommunicationsController } from './communications.controller.js';
import { ProviderResolverService } from './provider-resolver.service.js';

/**
 * Gateway module for provider-agnostic Communications concerns: the cross-company
 * unified counts controller and the provider resolver. Imports both provider modules
 * (which export their services). The base MessageStateModule stays separate so the
 * provider modules can depend on it without a cycle.
 */
@Module({
  imports: [GmailModule, MicrosoftModule],
  controllers: [CommunicationsController],
  providers: [ProviderResolverService],
  exports: [ProviderResolverService],
})
export class CommunicationsModule {}

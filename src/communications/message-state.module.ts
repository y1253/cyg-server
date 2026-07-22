import { Module } from '@nestjs/common';
import { MessageStateService } from './message-state.service.js';

/**
 * Base shared module for the Communications feature. Provides the provider-agnostic
 * inbox state service (read/completed/forwarded + count caches) that both the Gmail
 * and Microsoft provider modules import. Kept dependency-free (only PrismaService,
 * which is global) so the provider modules can import it without a cycle.
 */
@Module({
  providers: [MessageStateService],
  exports: [MessageStateService],
})
export class MessageStateModule {}

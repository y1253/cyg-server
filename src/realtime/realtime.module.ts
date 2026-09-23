import { Global, Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeService } from './realtime.service.js';

/**
 * `@Global()` and dependency-free, both on purpose.
 *
 * Publish sites live in `PhoneModule`, `CommunicationsModule`, `WhatsAppModule`,
 * `GmailModule`, `InternalMessagesModule` and `InternalCallsModule` — and those modules
 * already form a one-directional chain that `PhoneEventsService`'s rxjs subjects exist to
 * work around. A provider with no imports of its own cannot close a cycle, and making it
 * global means no module has to add an import edge to reach it.
 */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}

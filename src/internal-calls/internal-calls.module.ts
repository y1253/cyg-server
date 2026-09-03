import { Module } from '@nestjs/common';
import { PhoneModule } from '../phone/phone.module.js';
import { InternalCallsController } from './internal-calls.controller.js';
import { InternalCallsService } from './internal-calls.service.js';

/**
 * Its own module rather than more surface on PhoneModule, which already carries two
 * controllers and six services under a deliberate separation rule — and because these
 * routes are user-scoped while every phone route is company-scoped.
 *
 * Imports PhoneModule for SignalWireService and PhoneEventsService. One-way: the phone
 * module knows nothing about this one, so there is no cycle. PrismaModule is global.
 */
@Module({
  imports: [PhoneModule],
  controllers: [InternalCallsController],
  providers: [InternalCallsService],
  exports: [InternalCallsService],
})
export class InternalCallsModule {}

import { Module } from '@nestjs/common';
import { PhoneController } from './phone.controller.js';
import { PhoneWebhooksController } from './phone-webhooks.controller.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { SignalWireService } from './signalwire.service.js';
import { CallRoutingService } from './call-routing.service.js';
import { PhoneEventsService } from './phone-events.service.js';

/**
 * Imports nothing: PrismaModule and ConfigModule are both global.
 *
 * Exports PhoneProvisioningService because CompaniesModule injects it to auto-provision
 * a number at registration. The dependency runs one way only — nothing here knows about
 * CompaniesService — so there is no cycle.
 */
@Module({
  // PhoneWebhooksController is UNAUTHENTICATED (SignalWire cannot present a JWT) and
  // verifies request signatures instead. Kept a separate class from PhoneController,
  // which is entirely JWT-guarded, so the two auth models never blur together.
  controllers: [PhoneController, PhoneWebhooksController],
  providers: [
    SignalWireService,
    PhoneProvisioningService,
    CallRoutingService,
    PhoneEventsService,
  ],
  exports: [PhoneProvisioningService],
})
export class PhoneModule {}

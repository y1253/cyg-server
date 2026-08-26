import { Module } from '@nestjs/common';
import { PhoneController } from './phone.controller.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { SignalWireService } from './signalwire.service.js';

/**
 * Imports nothing: PrismaModule and ConfigModule are both global.
 *
 * Exports PhoneProvisioningService because CompaniesModule injects it to auto-provision
 * a number at registration. The dependency runs one way only — nothing here knows about
 * CompaniesService — so there is no cycle.
 */
@Module({
  controllers: [PhoneController],
  providers: [SignalWireService, PhoneProvisioningService],
  exports: [PhoneProvisioningService],
})
export class PhoneModule {}

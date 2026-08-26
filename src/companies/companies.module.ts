import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { PhoneModule } from '../phone/phone.module.js';

@Module({
  // The one place a feature module needs an import: PhoneProvisioningService is a
  // cross-module provider, unlike the global PrismaService. One-way, so no cycle.
  imports: [PhoneModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}

import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { PhoneModule } from '../phone/phone.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';

@Module({
  // Cross-module providers, unlike the global PrismaService. Both one-way, so no cycle:
  // ContactsModule reaches Companies only through the free `assertRealCompany` function.
  imports: [PhoneModule, ContactsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}

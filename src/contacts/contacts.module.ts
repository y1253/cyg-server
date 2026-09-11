import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService],
  // CompaniesService calls syncAutoContacts when a company is registered or edited.
  exports: [ContactsService],
})
export class ContactsModule {}

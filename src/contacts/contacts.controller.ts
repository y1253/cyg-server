import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

/**
 * Per-company contacts: a name for a phone number.
 *
 * ⚠️ Writes are JWT-only, NOT `@Roles(...MANAGEMENT_ROLES)` — which is where this departs
 * from `notes` and `links`, whose shape it otherwise copies. Whoever is on the phone with
 * somebody new is the person who should be able to save them, and that is usually not an
 * admin. The blast radius is one company's address book, and every row records nothing an
 * assigned user could not already read off the timeline.
 */
@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('company/:companyId')
  findByCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.contacts.findByCompany(companyId);
  }

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contacts.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContactDto) {
    return this.contacts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.contacts.remove(id);
  }
}

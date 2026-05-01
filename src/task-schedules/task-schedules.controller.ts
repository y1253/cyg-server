import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { TaskSchedulesService } from './task-schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('task-schedules')
export class TaskSchedulesController {
  constructor(private readonly service: TaskSchedulesService) {}

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateScheduleDto) {
    return this.service.create(dto);
  }

  @Get()
  findByCompany(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.service.findByCompany(companyId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateScheduleDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/toggle')
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggle(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/toggle-important')
  toggleImportant(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggleImportant(id);
  }
}

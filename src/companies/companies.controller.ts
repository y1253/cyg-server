import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CompaniesService } from './companies.service.js';
import { AssignCompanyDto } from './dto/assign-company.dto.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /** Public — no auth required */
  @Post('register')
  register(@Body() dto: RegisterCompanyDto) {
    return this.companiesService.register(dto);
  }

  /** Returns all companies (admin) or assigned companies (user) with todo counts */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Request() req: { user: { userId: number; role: string } }) {
    return this.companiesService.findAll(req.user.userId, req.user.role);
  }

  /** Admin: list all soft-deleted companies */
  @Get('deleted')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findAllDeleted() {
    return this.companiesService.findAllDeleted();
  }

  /** Admin: restore a soft-deleted company */
  @Patch(':id/restore')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.restore(id);
  }

  /** Admin: permanently delete a soft-deleted company and all its data */
  @Delete(':id/permanent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  permanentDelete(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.permanentDelete(id);
  }

  /** Returns full company detail + todos */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { userId: number; role: string } },
  ) {
    return this.companiesService.findOne(id, req.user.userId, req.user.role);
  }

  /** Admin: update company fields (e.g. supportNumber) */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(id, dto);
  }

  /** Admin: soft-delete a company */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.remove(id);
  }

  /** Admin: assign or unassign a user to a company */
  @Patch(':id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  assignUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignCompanyDto,
  ) {
    return this.companiesService.assignUser(id, dto.userId);
  }
}

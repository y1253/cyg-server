import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { PhoneSettingsService } from './phone-settings.service.js';
import { PLACEHOLDERS } from './phone-message.util.js';
import { UpdatePhoneDefaultsDto } from './dto/update-phone-defaults.dto.js';
import { UpdateCompanyPhoneSettingsDto } from './dto/update-company-phone-settings.dto.js';
import { PreviewMessageDto } from './dto/preview-message.dto.js';

/**
 * Admin configuration of what the phone does: business hours, and what a caller hears in
 * and out of them.
 *
 * ADMIN-only at the class level. Every route here writes or reads configuration that
 * decides how a client-facing line behaves, and none of it is per-user, so there is no
 * case for a JWT-only route in this class — which also keeps it categorically separate
 * from `phone-webhooks.controller.ts`, whose routes are deliberately unguarded.
 *
 * The split along that class gate is the MANAGER boundary, and it follows the UI: the
 * firm-wide `/defaults` are edited from the Company Settings page a manager does not
 * have, so those two routes keep the class default; the per-company routes back the
 * PhoneSettingsSection card on a company's Details tab, which a manager does have, so
 * they are widened by hand. The per-company GET returns `defaults` in its own payload,
 * so the card still renders its inherited values without reaching `/defaults`.
 */
@Controller('phone-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PhoneSettingsController {
  constructor(private readonly settings: PhoneSettingsService) {}

  /** The global defaults every company inherits. */
  @Get('defaults')
  async getDefaults() {
    const defaults = await this.settings.getDefaults();
    return { defaults, placeholders: PLACEHOLDERS };
  }

  @Patch('defaults')
  async updateDefaults(@Body() dto: UpdatePhoneDefaultsDto) {
    const defaults = await this.settings.updateDefaults(dto);
    return { defaults, placeholders: PLACEHOLDERS };
  }

  /**
   * One company's overrides, the resolved values, and the defaults behind them.
   *
   * All three in one response so the card can render "Use default" boxes with the
   * inherited value visible without a second fetch.
   */
  @Get('companies/:companyId')
  @Roles(...MANAGEMENT_ROLES)
  getForCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.settings.getForCompany(companyId);
  }

  /** A key with `null` clears that override; an absent key leaves it alone. */
  @Patch('companies/:companyId')
  @Roles(...MANAGEMENT_ROLES)
  updateForCompany(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: UpdateCompanyPhoneSettingsDto,
  ) {
    return this.settings.updateForCompany(companyId, dto);
  }

  @Post('companies/:companyId/reset')
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.OK)
  resetForCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.settings.resetForCompany(companyId);
  }

  /** "What would a caller actually hear?" — read-only, writes nothing. */
  @Post('preview')
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewMessageDto) {
    return this.settings.preview(dto.template, dto.companyId, dto.at);
  }
}

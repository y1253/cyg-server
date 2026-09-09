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
import { EmailSignatureService } from './email-signature.service.js';
import { PLACEHOLDERS } from './signature-template.util.js';
import { UpdateSignatureDefaultsDto } from './dto/update-signature-defaults.dto.js';
import { UpdateCompanyEmailSignatureDto } from './dto/update-company-signature.dto.js';
import { PreviewSignatureDto } from './dto/preview-signature.dto.js';

/**
 * The email signature: one firm-wide default, overridable per company.
 *
 * ── THE ROLE SPLIT ──────────────────────────────────────────────────────────────
 * ADMIN at the class level, then widened by hand where the UI is a manager's. The
 * firm-wide `/defaults` are edited from the Company Settings page, which a manager does
 * not have; the per-company routes back the SignatureSettingsSection card on a company's
 * Details tab, which a manager does. Same split, same reasoning, as
 * `PhoneSettingsController`.
 *
 * `RolesGuard` is exact membership with no hierarchy, so a route left at the class default
 * stays admin-only — a new route has to be opted IN to manager access rather than out.
 */
@Controller('email-signature')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class EmailSignatureController {
  constructor(private readonly signatures: EmailSignatureService) {}

  @Get('defaults')
  async getDefaults() {
    const defaults = await this.signatures.getDefaults();
    return { defaults, placeholders: PLACEHOLDERS };
  }

  @Patch('defaults')
  async updateDefaults(@Body() dto: UpdateSignatureDefaultsDto) {
    const defaults = await this.signatures.updateDefaults(dto);
    return { defaults, placeholders: PLACEHOLDERS };
  }

  @Get('companies/:companyId')
  @Roles(...MANAGEMENT_ROLES)
  getForCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.signatures.getForCompany(companyId);
  }

  @Patch('companies/:companyId')
  @Roles(...MANAGEMENT_ROLES)
  updateForCompany(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: UpdateCompanyEmailSignatureDto,
  ) {
    return this.signatures.updateForCompany(companyId, dto);
  }

  /** Creates nothing, hence 200 rather than 201. */
  @Post('companies/:companyId/reset')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGEMENT_ROLES)
  resetForCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.signatures.resetForCompany(companyId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGEMENT_ROLES)
  preview(@Body() dto: PreviewSignatureDto) {
    return this.signatures.preview(
      dto.template,
      dto.companyId,
      dto.signatureImageId,
    );
  }
}

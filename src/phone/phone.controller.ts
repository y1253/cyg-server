import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';

@Controller('phone')
export class PhoneController {
  constructor(private readonly provisioning: PhoneProvisioningService) {}

  /**
   * Search purchasable numbers. Admin only, because every call hits a paid provider.
   *
   * Declared above the `companies/:companyId/...` routes: Nest matches in declaration
   * order, and a static segment must never sit below a parameterised sibling.
   *
   * Query params are validated in the service rather than by a DTO — the global
   * ValidationPipe does not apply to individually injected @Query values, so a DTO here
   * would be decorative.
   */
  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  searchAvailable(
    @Query('country') country: string,
    @Query('areaCode') areaCode?: string,
  ) {
    return this.provisioning.searchAvailable(country, areaCode);
  }

  /**
   * The company's active support number, or null.
   *
   * Returns null rather than 404-ing, matching `GET /gmail/companies/:id/account`, so
   * the client hook needs no error branch for the ordinary "not connected yet" case.
   */
  @Get('companies/:companyId/number')
  @UseGuards(JwtAuthGuard)
  getNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.getActiveNumber(companyId);
  }

  /** Buy a number, point its webhooks at us, and attach it. Admin only. */
  @Post('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  attachNumber(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: AttachNumberDto,
  ) {
    return this.provisioning.attachNumber(
      companyId,
      dto.phoneNumber,
      dto.region,
    );
  }

  /** Release the number back to SignalWire. Permanent — billing stops. Admin only. */
  @Delete('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  releaseNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.releaseNumber(companyId);
  }
}

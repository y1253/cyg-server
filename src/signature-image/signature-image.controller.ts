import {
  BadRequestException,
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
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { SignatureImageService } from './signature-image.service.js';
import {
  imageFileFilter,
  signatureImageStorage,
  SIGNATURE_IMAGE_MULTER_LIMITS,
} from './signature-image.storage.js';

type AuthedRequest = { user: { userId: number } };

/**
 * Managing the signature-logo library. ADMIN only at the class level, because uploading
 * and deleting a logo is a firm-wide act reached from the Company Settings page.
 *
 * The route that SERVES the bytes deliberately lives in its own controller
 * (`SignatureImagePublicController`), because it has to be completely unauthenticated to
 * work in a stranger's mail client. Mixing a guarded class with one unguarded route is how
 * an unguarded route eventually gets added by accident — the same reason
 * `PhoneWebhooksController` and `PhoneAudioController` are separate classes.
 */
@Controller('signature-images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SignatureImageController {
  constructor(private readonly images: SignatureImageService) {}

  /**
   * Widened to the management tier: the per-company `SignatureSettingsSection` renders the
   * logo picker off this list, and a manager has that card.
   *
   * `RolesGuard` uses `getAllAndOverride`, so this REPLACES the class-level `@Roles`
   * rather than adding to it.
   */
  @Get()
  @Roles(...MANAGEMENT_ROLES)
  list() {
    return this.images.list();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: signatureImageStorage,
      limits: SIGNATURE_IMAGE_MULTER_LIMITS,
      fileFilter: imageFileFilter,
    }),
  )
  upload(
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body('name') name: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.images.create(file, name, req.user.userId);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string | undefined,
  ) {
    return this.images.rename(id, name ?? '');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.images.remove(id);
  }
}

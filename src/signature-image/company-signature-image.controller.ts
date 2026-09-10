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
 * One company's own signature logos — uploaded from the `SignatureSettingsSection` card on
 * its Details tab, offered only in that company's picker.
 *
 * ── WHY THIS IS ITS OWN CLASS ────────────────────────────────────────────────────
 * `SignatureImageController` next door is `@Roles(Role.ADMIN)` and firm-wide. Every route
 * here is management-tier and per-company, so rather than four hand-written
 * `@Roles(...MANAGEMENT_ROLES)` overrides on that class, the whole class carries the wider
 * gate. This is CLAUDE.md's "split rather than widen" rule, and it is stronger here than in
 * its three precedents for two reasons:
 *
 *   1. `RolesGuard` uses `getAllAndOverride`, so FORGETTING one of those overrides is
 *      SILENT — the route simply becomes admin-only and nobody notices until a manager
 *      complains. On a class of its own there is nothing to forget.
 *   2. `:companyId` lives in the CONTROLLER BASE PATH, so "forgot to scope the query" is a
 *      missing-argument compile error rather than a privilege escalation. Every method
 *      below must pass `companyId` into the service; none of them can quietly not.
 *
 * A `?companyId=` parameter on the admin controller was rejected: one route would then
 * serve a firm-wide ADMIN act and a per-company MANAGER act, forcing its gate down to
 * MANAGEMENT_ROLES with the admin-only half enforced by an `if` inside the handler — a
 * declarative, greppable, fail-closed gate traded for a conditional in a method body.
 *
 * ── ROUTE ORDER IS A NON-ISSUE, AND HERE IS WHY ──────────────────────────────────
 * Express matches on segment count first. `PATCH /signature-images/:id` is 2 segments and
 * can never eat this class's 4-segment `.../companies/:companyId/:id`; and the two
 * 3-segment routes in the module (`.../companies/:companyId` and `.../public/:publicId`)
 * differ on a LITERAL second segment. So declaration order is irrelevant here.
 *
 * ⚠️ The invariant that keeps it that way: **never add a single-segment wildcard**
 * (`@Get(':id')`, `@Post(':id')`) to `SignatureImageController` — that WOULD shadow both
 * `companies` and `public`.
 */
@Controller('signature-images/companies/:companyId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...MANAGEMENT_ROLES)
export class CompanySignatureImageController {
  constructor(private readonly images: SignatureImageService) {}

  /** The firm-wide logos PLUS this company's own — everything its picker may offer. */
  @Get()
  list(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.images.list(companyId);
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
    @Param('companyId', ParseIntPipe) companyId: number,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body('name') name: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.images.create(file, name, req.user.userId, companyId);
  }

  /**
   * Rename or delete one of THIS company's logos.
   *
   * The service checks `isImageInLibrary`, not `isImageVisibleTo`: a firm-wide logo is
   * listed above and selectable, and must still 404 here. Otherwise a manager could rename
   * or delete the firm's shared logo from inside a company.
   */
  @Patch(':id')
  rename(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string | undefined,
  ) {
    return this.images.rename(id, name ?? '', companyId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.images.remove(id, companyId);
  }
}

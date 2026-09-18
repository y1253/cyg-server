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
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { audioFileFilter } from '../phone-audio/phone-audio.storage.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppProvisioningService } from './whatsapp-provisioning.service.js';
import {
  MAX_VOICE_BYTES,
  WHATSAPP_OUTBOX_SUBDIR,
  WhatsAppMessagesService,
  type StagedUpload,
  type UploadedVoice,
} from './whatsapp-messages.service.js';
import { stagedUploadStorage } from '../communications/staged-uploads.js';
import { WHATSAPP_MEDIA_MAX_BYTES } from './whatsapp.util.js';
import {
  ConnectWhatsAppDto,
  CreateWhatsAppTemplateDto,
  GenerateWhatsAppTemplateDto,
  SendWhatsAppDto,
  SendWhatsAppTemplateDto,
} from './dto/whatsapp.dto.js';
import type { WhatsAppStateAction } from './whatsapp.types.js';

type AuthedRequest = { user: { userId: number } };

const STATE_ACTIONS = new Set<WhatsAppStateAction>([
  'read',
  'unread',
  'complete',
  'uncomplete',
]);

/**
 * Everything a logged-in browser does with WhatsApp. JWT on the class.
 *
 * Reads and sending follow the SMS tier (any authenticated user, as `phone.controller`'s
 * timeline/sms routes do). Connecting and disconnecting are MANAGEMENT_ROLES, like the
 * mailbox connect routes; attaching the FIRM's own number is ADMIN only, since it hands a
 * company the firm's shared token.
 *
 * The two unauthenticated routes (Meta's webhook, the media stream) live in
 * `WhatsAppPublicController` — a guarded class with one unguarded route is how the next
 * unguarded route gets added by accident.
 */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(
    private readonly accounts: WhatsAppAccountService,
    private readonly messages: WhatsAppMessagesService,
    private readonly provisioning: WhatsAppProvisioningService,
  ) {}

  /** The Embedded Signup popup's public config. No secrets. */
  @Get('config')
  config() {
    return this.accounts.clientConfig();
  }

  /**
   * Wrapped in an object rather than returning null: Nest sends a nil return as a 200
   * with an empty body, which is not valid JSON (the trap `communications.controller`
   * documents).
   */
  @Get('companies/:companyId/account')
  async account(@Param('companyId', ParseIntPipe) companyId: number) {
    return { account: await this.accounts.getAccount(companyId) };
  }

  @Post('companies/:companyId/connect')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  connect(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: ConnectWhatsAppDto,
    @Request() req: AuthedRequest,
  ) {
    return this.accounts.connect(companyId, dto, req.user.userId);
  }

  /**
   * "Generate WhatsApp account": add the company's support number to the firm's WABA and
   * verify it from Meta's SMS. Returns at once with `setupStatus: PENDING_CODE`; the
   * client polls the account until it turns CONNECTED or FAILED. A 409 with
   * `code: NO_SUPPORT_NUMBER` tells the client to open the buy-a-number popup.
   */
  @Post('companies/:companyId/generate')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  generate(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: AuthedRequest,
  ) {
    return this.provisioning.generate(companyId, req.user.userId);
  }

  @Delete('companies/:companyId/account')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Param('companyId', ParseIntPipe) companyId: number) {
    await this.accounts.disconnect(companyId);
  }

  @Get('companies/:companyId/timeline')
  timeline(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedCursor = Number.parseInt(cursor ?? '', 10);
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    return this.messages.getTimeline(
      companyId,
      Number.isInteger(parsedCursor) && parsedCursor > 0
        ? parsedCursor
        : undefined,
      Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 100)
        : 25,
    );
  }

  /** `peer` in the query, like `sms-thread`. */
  @Get('companies/:companyId/thread')
  thread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('peer') peer: string,
  ) {
    return this.messages.getThread(companyId, peer ?? '');
  }

  @Get('companies/:companyId/counts')
  counts(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.messages.getCounts(companyId);
  }

  @Post('companies/:companyId/messages')
  send(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendWhatsAppDto,
    @Request() req: AuthedRequest,
  ) {
    return this.messages.sendText(
      companyId,
      dto.to,
      dto.body,
      req.user.userId,
      dto.replyToMessageId,
    );
  }

  /**
   * The approved templates this company may send — what the composer offers once the
   * 24-hour window is shut. Never throws on a permission Meta refuses; see the service.
   */
  @Get('companies/:companyId/templates')
  templates(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.messages.listTemplates(companyId);
  }

  /**
   * Send an approved template — the only way to write outside the 24-hour window, and
   * therefore the only way to START a conversation.
   */
  /**
   * Submit a new template for Meta's review.
   *
   * Management tier, matching connect/generate/disconnect: a template is firm-facing
   * content on a shared WABA, and — see below — once created it is visible to every
   * company on that WABA, not just this one.
   *
   * ⚠️ Every GENERATED number sits on the FIRM's WABA, so a template created here is
   * created THERE. Two companies cannot hold the same name+language, and a template one
   * company submits appears in another's picker. That is Meta's model, not a leak.
   */
  @Post('companies/:companyId/templates')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  createTemplate(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CreateWhatsAppTemplateDto,
    @Request() req: { user: { userId: number } },
  ) {
    return this.messages.createTemplate(companyId, dto, req.user.userId);
  }

  /**
   * This company's own template submissions, for the inbox strip.
   *
   * ⚠️ JWT ONLY, deliberately NOT management-gated. The strip renders in every user's
   * inbox, so a 403 here becomes an error banner for every USER in the firm. It matches
   * the tier of `GET .../templates` beside it; the ACTIONS on a row are what carry the
   * management guard.
   */
  @Get('companies/:companyId/template-submissions')
  listTemplateSubmissions(
    @Param('companyId', ParseIntPipe) companyId: number,
  ) {
    return this.messages.listSubmissions(companyId);
  }

  /** Clear one submission off the strip. Management, like every other template action. */
  @Patch('companies/:companyId/template-submissions/:id/dismiss')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissTemplateSubmission(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.messages.dismissSubmission(companyId, id);
  }

  /**
   * Draft a template from a brief. Submits NOTHING — it fills the form for review.
   *
   * Management-gated to match `POST .../templates` rather than `/api/ai/*`, which is
   * JWT-only: the output is company-scoped and only a manager can act on it.
   */
  @Post('companies/:companyId/templates/generate')
  @UseGuards(RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  generateTemplate(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: GenerateWhatsAppTemplateDto,
  ) {
    return this.messages.generateTemplate(companyId, dto.description);
  }
  @Post('companies/:companyId/messages/template')
  sendTemplate(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendWhatsAppTemplateDto,
    @Request() req: AuthedRequest,
  ) {
    return this.messages.sendTemplateMessage(
      companyId,
      dto.to,
      dto.name,
      dto.language,
      dto.variables ?? [],
      req.user.userId,
    );
  }

  /**
   * A voice note recorded in the browser. No `storage` option, which is multer's in-memory
   * default: the bytes that arrive are not the bytes we keep (they are transcoded to
   * Ogg/Opus first) and Meta's 16 MB audio cap bounds the buffer — the phone-audio argument.
   */
  @Post('companies/:companyId/messages/voice')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_VOICE_BYTES, files: 1 },
      fileFilter: audioFileFilter,
    }),
  )
  sendVoice(
    @Param('companyId', ParseIntPipe) companyId: number,
    @UploadedFile() file: UploadedVoice | undefined,
    @Body('to') to: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No recording was uploaded');
    return this.messages.sendVoice(companyId, to ?? '', file, req.user.userId);
  }

  /**
   * Any file at all — the "attach anything, like real WhatsApp" route.
   *
   * ── WHY DISK, WHERE THE VOICE ROUTE ABOVE USES MEMORY ──────────────────────────
   * That route's in-memory default is justified BY its 16 MB cap. A document may be
   * 100 MB, and the memory path costs it several times over: multer's buffer, the
   * standalone `ArrayBuffer` copy the upload has to make, and the write to disk. A couple
   * of concurrent sends would take the box down. So multer writes it straight to a transit
   * directory and `sendMedia` streams it from there — the same argument
   * `outbound-uploads.ts` makes for large email attachments.
   *
   * The limit here is the LARGEST kind's; the real per-kind ceiling is enforced in the
   * service, where the file's kind is known. Multer only has a number, and picking the
   * smallest would refuse the documents this route exists for.
   *
   * No `fileFilter`: that is the point. Anything Meta will not take natively goes as a
   * document, which accepts every type — see `whatsappMediaKind`.
   */
  @Post('companies/:companyId/messages/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: stagedUploadStorage(WHATSAPP_OUTBOX_SUBDIR),
      limits: {
        fileSize: WHATSAPP_MEDIA_MAX_BYTES.document,
        files: 1,
        // A long caption arrives as a text FIELD beside the file, and multer's default
        // field ceiling is 1 MB — the trap `MESSAGE_MULTER_LIMITS` documents.
        fieldSize: 1024 * 1024,
      },
    }),
  )
  sendMedia(
    @Param('companyId', ParseIntPipe) companyId: number,
    @UploadedFile() file: StagedUpload | undefined,
    @Body('to') to: string | undefined,
    @Body('caption') caption: string | undefined,
    @Body('replyToMessageId') replyToMessageId: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    const replyTo = Number(replyToMessageId);
    return this.messages.sendMedia(companyId, to ?? '', file, req.user.userId, {
      caption,
      replyToMessageId:
        Number.isInteger(replyTo) && replyTo > 0 ? replyTo : undefined,
    });
  }

  @Patch('companies/:companyId/items/:messageId/:action')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setState(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Param('action') action: string,
  ) {
    if (!STATE_ACTIONS.has(action as WhatsAppStateAction)) {
      throw new BadRequestException('Unknown action');
    }
    await this.messages.setState(
      companyId,
      messageId,
      action as WhatsAppStateAction,
    );
  }
}

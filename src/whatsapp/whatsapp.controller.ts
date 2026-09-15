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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { audioFileFilter } from '../phone-audio/phone-audio.storage.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppProvisioningService } from './whatsapp-provisioning.service.js';
import {
  MAX_VOICE_BYTES,
  WhatsAppMessagesService,
  type UploadedVoice,
} from './whatsapp-messages.service.js';
import { ConnectWhatsAppDto, SendWhatsAppDto } from './dto/whatsapp.dto.js';
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

  @Post('companies/:companyId/connect-firm-number')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  connectFirmNumber(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: AuthedRequest,
  ) {
    return this.accounts.connectFirmNumber(companyId, req.user.userId);
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
    return this.messages.sendText(companyId, dto.to, dto.body, req.user.userId);
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

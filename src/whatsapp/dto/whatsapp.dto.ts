import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

/** What the Embedded Signup popup hands the client, posted straight here. */
export class ConnectWhatsAppDto {
  @IsString()
  @Length(1, 4096)
  code!: string;

  @Matches(/^\d{5,30}$/, { message: 'wabaId must be a numeric id' })
  wabaId!: string;

  @Matches(/^\d{5,30}$/, { message: 'phoneNumberId must be a numeric id' })
  phoneNumberId!: string;
}

export class SendWhatsAppTemplateDto {
  /** The customer's WhatsApp id: digits only, no "+". */
  @Matches(/^\d{6,15}$/, { message: 'to must be 6-15 digits' })
  to!: string;

  /** The approved template's name, as Meta stores it. */
  @IsString()
  @Length(1, 512)
  name!: string;

  /** Meta's language code for that template, e.g. `en_US`. Echoed back verbatim. */
  @IsString()
  @Length(2, 16)
  language!: string;

  /**
   * Positional `{{1}}`, `{{2}}` fills. Optional because most utility templates have none.
   * Capped at 20: Meta's own limit is lower, and an unbounded array is a free write
   * amplifier on a route that reaches an external API.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  variables?: string[];
}

export class SendWhatsAppDto {
  /** The customer's WhatsApp id: digits only, no "+". */
  @Matches(/^\d{6,15}$/, { message: 'to must be 6-15 digits' })
  to!: string;

  /** Meta's text message limit. */
  @IsString()
  @Length(1, 4096)
  body!: string;

  /**
   * Reply natively to this message — OUR numeric id, never Meta's `wamid`, which never
   * leaves the server. Absent = a plain message.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  replyToMessageId?: number;
}

/**
 * Submit a WhatsApp message template for Meta's review.
 *
 * The validators mirror the pure rules in `whatsapp.util.ts` so a mistake is refused here
 * with a sentence somebody can act on, rather than as Meta's own 400 — whose wording does
 * not mention that uppercase is rejected outright, or that `en-US` must be `en_US`.
 */
export class CreateWhatsAppTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,512}$/, {
    message:
      'name may use only lowercase letters, numbers and underscores, e.g. appointment_reminder',
  })
  name: string;

  @IsString()
  @Matches(/^[a-z]{2,3}(_[A-Z]{2})?$/, {
    message: 'language must be a locale like en_US or fr, not en-US',
  })
  language: string;

  /** AUTHENTICATION is excluded on purpose — see `TEMPLATE_CATEGORIES`. */
  @IsIn(['UTILITY', 'MARKETING'], {
    message: 'category must be UTILITY or MARKETING',
  })
  category: string;

  @IsString()
  @Length(1, 1024)
  body: string;

  /**
   * One sample value per `{{n}}`, in order.
   *
   * Meta REQUIRES an example for every placeholder and rejects the submission without
   * one. Optional here because `buildTemplateComponents` fills any gap with a visible
   * stand-in rather than failing the request — a reviewer seeing `example1` learns more
   * than one seeing a blank.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  examples?: string[];
}

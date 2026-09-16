import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
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
}

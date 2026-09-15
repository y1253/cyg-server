import { IsString, Length, Matches } from 'class-validator';

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

export class SendWhatsAppDto {
  /** The customer's WhatsApp id: digits only, no "+". */
  @Matches(/^\d{6,15}$/, { message: 'to must be 6-15 digits' })
  to!: string;

  /** Meta's text message limit. */
  @IsString()
  @Length(1, 4096)
  body!: string;
}

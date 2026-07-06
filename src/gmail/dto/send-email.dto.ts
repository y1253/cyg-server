import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendEmailDto {
  @IsEmail()
  to: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  // Optional HTML representation of the body (rich-text compose/reply). When
  // present, the message is sent as multipart/alternative with `body` as the
  // plain-text fallback.
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsEmail()
  cc?: string;

  @IsOptional()
  @IsString()
  inReplyTo?: string;

  @IsOptional()
  @IsString()
  threadId?: string;
}

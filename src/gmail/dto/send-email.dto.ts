import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendEmailDto {
  @IsEmail()
  to: string;

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  body: string;

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

import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendChatMessageDto {
  @IsNotEmpty()
  @IsString()
  spaceId: string;

  @IsNotEmpty()
  @IsString()
  text: string;

  // Native "Quote in reply": the resource name + lastUpdateTime of the message
  // being quoted. Both must be present for the quote to be applied.
  @IsOptional()
  @IsString()
  quotedMessageName?: string;

  @IsOptional()
  @IsString()
  quotedMessageLastUpdateTime?: string;
}

import { IsNotEmpty, IsString } from 'class-validator';

export class SendChatMessageDto {
  @IsNotEmpty()
  @IsString()
  spaceId: string;

  @IsNotEmpty()
  @IsString()
  text: string;
}

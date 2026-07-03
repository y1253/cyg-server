import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class PolishReplyDto {
  // Which medium the draft is for — controls the tone the AI aims for.
  @IsIn(['email', 'chat'])
  kind: 'email' | 'chat';

  // The user's rough draft reply (plain text).
  @IsNotEmpty()
  @IsString()
  draft: string;

  // The whole email / whole conversation, pre-assembled by the client, given to
  // the model as context so the polished reply fits the thread.
  @IsNotEmpty()
  @IsString()
  context: string;
}

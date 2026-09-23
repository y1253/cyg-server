import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** The channels a draft can be polished for. `medium` in the prompt is built from this. */
export const POLISH_KINDS = ['email', 'chat', 'sms', 'whatsapp'] as const;
export type PolishKind = (typeof POLISH_KINDS)[number];

export class PolishReplyDto {
  // Which medium the draft is for — controls the tone the AI aims for.
  @IsIn(POLISH_KINDS)
  kind: PolishKind;

  /**
   * The user's rough draft reply (plain text).
   *
   * Bounded for the reason `TranslateDto.text` gives: this route is callable by any
   * authenticated user and every character is billed. 8000 is far past anything anybody
   * types into a composer, and well past an SMS or a WhatsApp caption.
   */
  @IsNotEmpty()
  @IsString()
  @MaxLength(8000)
  draft: string;

  /**
   * The whole email / whole conversation, pre-assembled by the client, given to
   * the model as context so the polished reply fits the thread.
   *
   * ⚠️ This is the field `TranslateDto` calls out by name as an unbounded per-token bill.
   * It is bounded now. 16000 characters is a long thread; the client trims from the OLD
   * end so the most recent messages — the ones that set the tone — always survive.
   */
  @IsNotEmpty()
  @IsString()
  @MaxLength(16000)
  context: string;

  /**
   * Keep the polished reply within this many characters, when the user has asked for it.
   *
   * Optional because it is a CHOICE, not a property of the channel: a text is billed per
   * 160-character segment, so a one-segment draft coming back as three is a silent 3x —
   * but somebody who genuinely wants a longer text should be able to have one. The client
   * shows a toggle and only sends this when it is ticked.
   *
   * Advisory. The model is asked, not forced, so the caller must still check the result;
   * `PolishPanel` does, and blocks Accept when the budget is a hard provider limit.
   */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(8000)
  maxChars?: number;
}

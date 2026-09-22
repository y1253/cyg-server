import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TranslateDto {
  /**
   * The received message, as it was written.
   *
   * ⚠️ `@MaxLength` is not optional here, and the neighbouring `PolishReplyDto` is a
   * counter-example rather than a precedent: its `context` is unbounded, which is an
   * unbounded per-token bill on a route any authenticated user can call. 8000 characters
   * is several screens of email, well past anything a customer writes.
   */
  @IsNotEmpty()
  @IsString()
  @MaxLength(8000)
  text: string;
}

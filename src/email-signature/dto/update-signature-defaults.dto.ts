import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * The firm-wide signature.
 *
 * Every field is `@IsOptional()` and **non-nullable**: this row is the bottom of the
 * resolution chain, so there is nothing below it to inherit from and `null` would be
 * meaningless. Compare `UpdateCompanyEmailSignatureDto`, where `null` is the whole point.
 *
 * The global ValidationPipe runs `whitelist: true`, so any field without a decorator here
 * is silently stripped before it reaches the service.
 */
export class UpdateSignatureDefaultsDto {
  /**
   * Rich HTML with `{company name}`-style tokens.
   *
   * The cap is generous because this is real markup, not a sentence — a signature with a
   * table and inline styles runs long. It is still bounded: this string is stored, served
   * on every `getAccount`, and pasted into every outgoing email.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  signatureHtml?: string;

  /** `@Min(0)` not `@Min(1)`: 0 is the "no logo" value, not an absence. */
  @IsOptional()
  @IsInt()
  @Min(0)
  signatureImageId?: number;
}

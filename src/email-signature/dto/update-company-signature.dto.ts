import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Per-company signature overrides.
 *
 * Three distinct requests, and the DTO has to keep them apart:
 *
 *   key absent      → leave this override exactly as it is
 *   `"key": null`   → CLEAR the override; this field goes back to inheriting
 *   `"key": value`  → set the override
 *
 * The service tells the first two apart with `hasOwnProperty`, which is why
 * `JSON.stringify` dropping `undefined` is exactly the behaviour we want on the client.
 *
 * `@ValidateIf((_, value) => value !== null)` is what lets an explicit `null` bypass
 * `@IsString()` / `@IsInt()`. `@IsOptional()` alone would do it, but stating the null case
 * is the point of this DTO.
 */
export class UpdateCompanyEmailSignatureDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20000)
  signatureHtml?: string | null;

  /** null clears the override; 0 is "no logo" for this company specifically. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  signatureImageId?: number | null;
}

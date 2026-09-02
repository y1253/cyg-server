import { IsInt, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * "What would a caller actually hear?" — used by the admin UI's live preview.
 *
 * Read-only: it substitutes placeholders and reports whether the company is open, without
 * touching a stored setting. `at` exists so an admin can check the after-hours wording at
 * ten in the morning, which is the only time anyone is looking at this page.
 */
export class PreviewMessageDto {
  @IsString()
  @MaxLength(1000)
  template: string;

  /** Omit to preview against the global defaults with a sample company name. */
  @IsOptional()
  @IsInt()
  companyId?: number;

  /** ISO instant to evaluate at. Defaults to now. */
  @IsOptional()
  @IsISO8601()
  at?: string;
}

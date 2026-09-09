import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** "What would this template actually look like?" — read-only, renders nothing to disk. */
export class PreviewSignatureDto {
  @IsString()
  @MaxLength(20000)
  template!: string;

  /** Render against a real company. Omitted → the sample values from PLACEHOLDERS. */
  @IsOptional()
  @IsInt()
  @Min(1)
  companyId?: number;

  /** The logo to render for `{logo}`. 0 or omitted → no logo. */
  @IsOptional()
  @IsInt()
  @Min(0)
  signatureImageId?: number;
}

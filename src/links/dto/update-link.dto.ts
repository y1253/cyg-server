import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateLinkDto {
  @IsOptional()
  @IsString()
  label?: string;

  // Same skip as CreateLinkDto: without it, clearing a link's URL in the edit form
  // sends '' and is rejected with "url must be a URL address".
  @IsOptional()
  @ValidateIf((o: UpdateLinkDto) => o.url !== undefined && o.url !== null && o.url !== '')
  @IsUrl({ require_protocol: false })
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

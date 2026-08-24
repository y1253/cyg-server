import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateLinkDto {
  @IsInt()
  companyId: number;

  @IsNotEmpty()
  @IsString()
  label: string;

  // Optional — a link row is often just a credential store. `@IsUrl` rejects '',
  // so it has to be skipped outright for an absent/blank value rather than merely
  // marked optional; the service normalises '' to null.
  @IsOptional()
  @ValidateIf((o: CreateLinkDto) => o.url !== undefined && o.url !== null && o.url !== '')
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

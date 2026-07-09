import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateLinkDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
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

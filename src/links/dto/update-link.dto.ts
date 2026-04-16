import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateLinkDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  url?: string;
}

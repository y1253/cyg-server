import { IsInt, IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class CreateLinkDto {
  @IsInt()
  companyId: number;

  @IsNotEmpty()
  @IsString()
  label: string;

  @IsUrl({ require_protocol: false })
  url: string;
}

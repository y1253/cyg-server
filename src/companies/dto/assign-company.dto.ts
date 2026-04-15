import { IsInt, IsOptional, Min } from 'class-validator';

export class AssignCompanyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  userId: number | null = null;
}

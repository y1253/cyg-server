import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AssignTaskDto {
  @IsInt()
  @Min(1)
  companyId: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cycle?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

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
}

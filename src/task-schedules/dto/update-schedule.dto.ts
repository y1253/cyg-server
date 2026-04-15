import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cycle?: number;
}

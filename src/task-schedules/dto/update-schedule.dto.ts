import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cycle?: number;

  @IsOptional()
  @IsEnum(['DAYS', 'MONTHLY_DATE', 'WEEKLY_DAY', 'MONTHLY_WEEKDAY'])
  cycleType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  cycleDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  cycleNth?: number | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}

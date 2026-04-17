import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cycle?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

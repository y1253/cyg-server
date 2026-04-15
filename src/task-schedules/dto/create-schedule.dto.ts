import { IsInt, Min } from 'class-validator';

export class CreateScheduleDto {
  @IsInt()
  taskId: number;

  @IsInt()
  companyId: number;

  @IsInt()
  @Min(1)
  cycle: number;
}

import { IsInt, Min } from 'class-validator';

export class SnoozeTodoDto {
  @IsInt()
  @Min(1)
  days: number;
}

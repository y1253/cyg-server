import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateNoteDto {
  @IsInt()
  @Min(1)
  companyId: number;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  note: string;
}

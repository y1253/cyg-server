import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateNoteDto {
  @IsInt()
  companyId: number;

  @IsNotEmpty()
  @IsString()
  content: string;
}

import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

/**
 * The company's link ids in their new display order.
 *
 * `companyId` is not redundant: the service scopes every write to it, so a caller
 * can't reorder — or touch — another company's rows by slipping foreign ids into
 * the array.
 */
export class ReorderLinksDto {
  @IsInt()
  companyId: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids: number[];
}

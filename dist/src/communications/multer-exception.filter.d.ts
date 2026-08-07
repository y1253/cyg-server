import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { MulterError } from 'multer';
export declare class MulterExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(err: MulterError, host: ArgumentsHost): void;
}

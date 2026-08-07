"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_js_1 = require("./app.module.js");
const multer_exception_filter_js_1 = require("./communications/multer-exception.filter.js");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_js_1.AppModule);
    app.enableCors({
        origin: true,
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new multer_exception_filter_js_1.MulterExceptionFilter());
    await app.listen(process.env.PORT ?? 3000);
    console.log('Server running on http://localhost:3000');
}
bootstrap();
//# sourceMappingURL=main.js.map
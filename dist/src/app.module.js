"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_controller_js_1 = require("./app.controller.js");
const app_service_js_1 = require("./app.service.js");
const prisma_module_js_1 = require("./prisma/prisma.module.js");
const users_module_js_1 = require("./users/users.module.js");
const auth_module_js_1 = require("./auth/auth.module.js");
const companies_module_js_1 = require("./companies/companies.module.js");
const todos_module_js_1 = require("./todos/todos.module.js");
const tasks_module_js_1 = require("./tasks/tasks.module.js");
const task_schedules_module_js_1 = require("./task-schedules/task-schedules.module.js");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            prisma_module_js_1.PrismaModule,
            users_module_js_1.UsersModule,
            auth_module_js_1.AuthModule,
            companies_module_js_1.CompaniesModule,
            todos_module_js_1.TodosModule,
            tasks_module_js_1.TasksModule,
            task_schedules_module_js_1.TaskSchedulesModule,
        ],
        controllers: [app_controller_js_1.AppController],
        providers: [app_service_js_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
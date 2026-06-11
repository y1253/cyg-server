"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskSchedulesModule = void 0;
const common_1 = require("@nestjs/common");
const task_schedules_service_1 = require("./task-schedules.service");
const task_schedules_controller_1 = require("./task-schedules.controller");
let TaskSchedulesModule = class TaskSchedulesModule {
};
exports.TaskSchedulesModule = TaskSchedulesModule;
exports.TaskSchedulesModule = TaskSchedulesModule = __decorate([
    (0, common_1.Module)({
        controllers: [task_schedules_controller_1.TaskSchedulesController],
        providers: [task_schedules_service_1.TaskSchedulesService],
        exports: [task_schedules_service_1.TaskSchedulesService],
    })
], TaskSchedulesModule);
//# sourceMappingURL=task-schedules.module.js.map
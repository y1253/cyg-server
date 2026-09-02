"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsIanaTimeZone = IsIanaTimeZone;
exports.IsWeeklyHours = IsWeeklyHours;
const class_validator_1 = require("class-validator");
const phone_hours_util_js_1 = require("./phone-hours.util.js");
const phone_settings_util_js_1 = require("./phone-settings.util.js");
function IsIanaTimeZone(options) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isIanaTimeZone',
            target: object.constructor,
            propertyName,
            options,
            validator: {
                validate: (value) => value === null || (0, phone_hours_util_js_1.isValidTimeZone)(value),
                defaultMessage: (args) => `${args.property} must be an IANA timezone id, e.g. America/Toronto`,
            },
        });
    };
}
function IsWeeklyHours(options) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isWeeklyHours',
            target: object.constructor,
            propertyName,
            options,
            validator: {
                validate: (value) => value === null || (0, phone_settings_util_js_1.parseWeeklyHours)(value) !== null,
                defaultMessage: (args) => `${args.property} must be 7 entries (0=Sunday), each null or ` +
                    `{ "open": "09:00", "close": "17:00" } in 24-hour HH:mm`,
            },
        });
    };
}
//# sourceMappingURL=phone-settings.validators.js.map
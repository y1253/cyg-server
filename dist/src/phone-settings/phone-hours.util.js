"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zonedNow = zonedNow;
exports.isValidTimeZone = isValidTimeZone;
exports.isOpenAt = isOpenAt;
exports.describeToday = describeToday;
const phone_settings_util_js_1 = require("./phone-settings.util.js");
const WEEKDAY_INDEX = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};
const formatterCache = new Map();
function formatterFor(timeZone) {
    const cached = formatterCache.get(timeZone);
    if (cached)
        return cached;
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    formatterCache.set(timeZone, fmt);
    return fmt;
}
function zonedNow(at, timeZone) {
    let parts;
    try {
        parts = formatterFor(timeZone).formatToParts(at);
    }
    catch {
        parts = formatterFor('UTC').formatToParts(at);
    }
    let weekday = 0;
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
        if (part.type === 'weekday')
            weekday = WEEKDAY_INDEX[part.value] ?? 0;
        else if (part.type === 'hour')
            hour = Number(part.value) % 24;
        else if (part.type === 'minute')
            minute = Number(part.value);
    }
    return { weekday, minutes: hour * 60 + minute };
}
function isValidTimeZone(timeZone) {
    if (typeof timeZone !== 'string' || timeZone.trim() === '')
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    }
    catch {
        return false;
    }
}
function inWindow(day, minutes) {
    if (!day)
        return false;
    const open = (0, phone_settings_util_js_1.parseTime)(day.open);
    const close = (0, phone_settings_util_js_1.parseTime)(day.close);
    if (open === null || close === null)
        return false;
    if (open === close)
        return false;
    return open < close ? minutes >= open && minutes < close : minutes >= open;
}
function spilledFrom(day, minutes) {
    if (!day)
        return false;
    const open = (0, phone_settings_util_js_1.parseTime)(day.open);
    const close = (0, phone_settings_util_js_1.parseTime)(day.close);
    if (open === null || close === null)
        return false;
    return open > close && minutes < close;
}
function isOpenAt(week, timeZone, at) {
    const { weekday, minutes } = zonedNow(at, timeZone);
    const today = week[weekday] ?? null;
    const yesterday = week[(weekday + 6) % 7] ?? null;
    return inWindow(today, minutes) || spilledFrom(yesterday, minutes);
}
function describeToday(week, timeZone, at) {
    const { weekday } = zonedNow(at, timeZone);
    const day = week[weekday] ?? null;
    if (!day)
        return 'closed today';
    const open = (0, phone_settings_util_js_1.parseTime)(day.open);
    const close = (0, phone_settings_util_js_1.parseTime)(day.close);
    if (open === null || close === null || open === close)
        return 'closed today';
    return `${speak(day.open)} to ${speak(day.close)}`;
}
function speak(hhmm) {
    const total = (0, phone_settings_util_js_1.parseTime)(hhmm) ?? 0;
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const suffix = hour24 < 12 ? 'AM' : 'PM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return minute === 0
        ? `${hour12} ${suffix}`
        : `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
//# sourceMappingURL=phone-hours.util.js.map
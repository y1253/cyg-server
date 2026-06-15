"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeNextDue = computeNextDue;
exports.computeFirstDue = computeFirstDue;
function computeNextDue(base, schedule) {
    switch (schedule.cycleType) {
        case 'MONTHLY_DATE': {
            const day = schedule.cycleDay ?? 1;
            const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
            const sameMonth = new Date(base.getFullYear(), base.getMonth(), day);
            if (sameMonth > baseDay && sameMonth.getDate() === day)
                return sameMonth;
            let m = base.getMonth() + 1;
            let y = base.getFullYear();
            if (m > 11) {
                m = 0;
                y++;
            }
            while (true) {
                const candidate = new Date(y, m, day);
                if (candidate.getDate() === day)
                    return candidate;
                m++;
                if (m > 11) {
                    m = 0;
                    y++;
                }
            }
        }
        case 'WEEKLY_DAY': {
            const target = schedule.cycleDay ?? 0;
            const next = new Date(base);
            next.setDate(next.getDate() + 1);
            const daysUntil = (target - next.getDay() + 7) % 7;
            next.setDate(next.getDate() + daysUntil);
            return next;
        }
        case 'MONTHLY_WEEKDAY': {
            const target = schedule.cycleDay ?? 0;
            const nth = schedule.cycleNth ?? 1;
            const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
            const firstOccurrence = (target - next.getDay() + 7) % 7;
            next.setDate(1 + firstOccurrence + (nth - 1) * 7);
            return next;
        }
        case 'QUARTERLY': {
            const day = schedule.cycleDay ?? 1;
            return new Date(base.getFullYear(), base.getMonth() + 3, day);
        }
        case 'YEARLY': {
            const month = (schedule.cycleNth ?? 1) - 1;
            const day = schedule.cycleDay ?? 1;
            const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
            const next = new Date(base.getFullYear(), month, day);
            if (next <= today)
                next.setFullYear(next.getFullYear() + 1);
            return next;
        }
        default: {
            const next = new Date(base);
            next.setDate(next.getDate() + schedule.cycle);
            return next;
        }
    }
}
function computeFirstDue(startDate, schedule) {
    switch (schedule.cycleType) {
        case 'MONTHLY_DATE': {
            const day = schedule.cycleDay ?? 1;
            const candidate = new Date(startDate.getFullYear(), startDate.getMonth(), day);
            if (candidate >= startDate && candidate.getDate() === day)
                return candidate;
            let m = startDate.getMonth() + 1;
            let y = startDate.getFullYear();
            if (m > 11) {
                m = 0;
                y++;
            }
            while (true) {
                const attempt = new Date(y, m, day);
                if (attempt.getDate() === day)
                    return attempt;
                m++;
                if (m > 11) {
                    m = 0;
                    y++;
                }
            }
        }
        case 'WEEKLY_DAY': {
            const target = schedule.cycleDay ?? 0;
            const daysUntil = (target - startDate.getDay() + 7) % 7;
            const result = new Date(startDate);
            result.setDate(result.getDate() + daysUntil);
            return result;
        }
        case 'MONTHLY_WEEKDAY': {
            const target = schedule.cycleDay ?? 0;
            const nth = schedule.cycleNth ?? 1;
            const firstOfMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
            const offset = (target - firstOfMonth.getDay() + 7) % 7;
            const candidate = new Date(startDate.getFullYear(), startDate.getMonth(), 1 + offset + (nth - 1) * 7);
            if (candidate >= startDate)
                return candidate;
            const nextMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
            const nextOffset = (target - nextMonth.getDay() + 7) % 7;
            return new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1 + nextOffset + (nth - 1) * 7);
        }
        case 'QUARTERLY': {
            const day = schedule.cycleDay ?? 1;
            const candidate = new Date(startDate.getFullYear(), startDate.getMonth(), day);
            if (candidate >= startDate)
                return candidate;
            return new Date(startDate.getFullYear(), startDate.getMonth() + 3, day);
        }
        case 'YEARLY': {
            const month = (schedule.cycleNth ?? 1) - 1;
            const day = schedule.cycleDay ?? 1;
            const candidate = new Date(startDate.getFullYear(), month, day);
            if (candidate >= startDate)
                return candidate;
            return new Date(startDate.getFullYear() + 1, month, day);
        }
        default: {
            return new Date(startDate);
        }
    }
}
//# sourceMappingURL=compute-next-due.js.map
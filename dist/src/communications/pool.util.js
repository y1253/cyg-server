"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GMAIL_GET_CONCURRENCY = void 0;
exports.pool = pool;
exports.GMAIL_GET_CONCURRENCY = 6;
async function pool(items, concurrency, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
}
//# sourceMappingURL=pool.util.js.map
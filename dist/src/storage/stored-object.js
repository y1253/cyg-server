"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamStoredObject = streamStoredObject;
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const uploads_js_1 = require("../internal-messages/uploads.js");
const storage_config_js_1 = require("./storage.config.js");
async function streamStoredObject(res, storage, key, opts = {}) {
    const { mimeType, filename, disposition, range, cacheControl } = opts;
    if (storage.driver === 'local') {
        return (0, attachment_stream_util_js_1.streamAttachmentFile)(res, (0, uploads_js_1.resolveStoredPath)(key), mimeType, filename, disposition, range, cacheControl);
    }
    const fallbackPath = (0, storage_config_js_1.localFallbackEnabled)(process.env)
        ? (0, uploads_js_1.resolveStoredPath)(key)
        : undefined;
    return (0, attachment_stream_util_js_1.streamAttachmentStored)(res, storage, key, mimeType, filename, disposition, range, cacheControl, fallbackPath);
}
//# sourceMappingURL=stored-object.js.map
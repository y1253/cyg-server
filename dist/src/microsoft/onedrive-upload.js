"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantsOneDriveUpload = grantsOneDriveUpload;
exports.uploadAllToOneDrive = uploadAllToOneDrive;
const graph_util_js_1 = require("./graph.util.js");
const FOLDER_NAME = 'Cyg Finance attachments';
function grantsOneDriveUpload(scope) {
    return (scope ?? '')
        .split(/\s+/)
        .map((s) => s.toLowerCase().split('/').pop() ?? '')
        .some((s) => s === 'files.readwrite' || s === 'files.readwrite.all');
}
function drivePath(filename) {
    return [FOLDER_NAME, filename]
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}
async function uploadAndShare(token, file) {
    const session = await (0, graph_util_js_1.graphPost)(token, `/me/drive/root:/${drivePath(file.originalname)}:/createUploadSession`, { item: { '@microsoft.graph.conflictBehavior': 'rename' } });
    const uploadUrl = session?.uploadUrl;
    if (!uploadUrl) {
        throw new Error(`OneDrive returned no uploadUrl for "${file.originalname}"`);
    }
    const item = await (0, graph_util_js_1.uploadFileInChunks)(uploadUrl, file.path, file.size, file.originalname);
    const itemId = item?.id;
    if (!itemId) {
        throw new Error(`OneDrive returned no item id for "${file.originalname}"`);
    }
    let url;
    for (const shareScope of ['anonymous', 'organization']) {
        try {
            const link = await (0, graph_util_js_1.graphPost)(token, `/me/drive/items/${itemId}/createLink`, { type: 'view', scope: shareScope });
            url = link?.link?.webUrl;
            if (url)
                break;
        }
        catch (err) {
            if (shareScope === 'organization') {
                throw new Error(`OneDrive refused to create a sharing link for "${file.originalname}" ` +
                    `(${err instanceof Error ? err.message : String(err)}). Your ` +
                    'Microsoft 365 tenant may block link sharing.');
            }
        }
    }
    if (!url) {
        url = item.webUrl ?? '';
        if (!url) {
            throw new Error(`OneDrive returned no sharing URL for "${file.originalname}"`);
        }
    }
    return { name: file.originalname, size: file.size, url };
}
async function uploadAllToOneDrive(token, files) {
    const links = [];
    for (const f of files) {
        links.push(await uploadAndShare(token, f));
    }
    return links;
}
//# sourceMappingURL=onedrive-upload.js.map
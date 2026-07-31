"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantsDriveUpload = grantsDriveUpload;
exports.makeDriveClient = makeDriveClient;
exports.uploadAndShare = uploadAndShare;
exports.uploadAllToDrive = uploadAllToDrive;
const fs_1 = require("fs");
const googleapis_1 = require("googleapis");
const FOLDER_NAME = 'Cyg Finance attachments';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
function grantsDriveUpload(scope) {
    return (scope ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}
function makeDriveClient(auth) {
    return googleapis_1.google.drive({ version: 'v3', auth });
}
async function ensureAttachmentFolder(drive) {
    const existing = await drive.files.list({
        q: `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and ` +
            "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id)',
        pageSize: 1,
    });
    const found = existing.data.files?.[0]?.id;
    if (found)
        return found;
    const created = await drive.files.create({
        requestBody: {
            name: FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
    });
    const id = created.data.id;
    if (!id)
        throw new Error('Drive did not return a folder id');
    return id;
}
async function uploadAndShare(drive, folderId, file) {
    const created = await drive.files.create({
        requestBody: {
            name: file.originalname,
            parents: [folderId],
        },
        media: {
            mimeType: file.mimetype || 'application/octet-stream',
            body: (0, fs_1.createReadStream)(file.path),
        },
        fields: 'id, webViewLink',
    });
    const fileId = created.data.id;
    if (!fileId)
        throw new Error(`Drive did not return an id for "${file.originalname}"`);
    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
    });
    let url = created.data.webViewLink ?? '';
    if (!url) {
        const meta = await drive.files.get({ fileId, fields: 'webViewLink' });
        url =
            meta.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
    }
    return { name: file.originalname, size: file.size, url };
}
async function uploadAllToDrive(drive, files) {
    if (files.length === 0)
        return [];
    const folderId = await ensureAttachmentFolder(drive);
    const links = [];
    for (const f of files) {
        links.push(await uploadAndShare(drive, folderId, f));
    }
    return links;
}
//# sourceMappingURL=drive-upload.js.map
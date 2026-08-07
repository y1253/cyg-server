"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBytes = formatBytes;
exports.buildLinkBlockHtml = buildLinkBlockHtml;
exports.buildLinkBlockText = buildLinkBlockText;
exports.appendLinkBlock = appendLinkBlock;
const PROVIDER_LABEL = {
    drive: 'Google Drive',
    onedrive: 'OneDrive',
};
function escapeHtml(text) {
    return (text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatBytes(bytes) {
    if (!bytes || bytes <= 0)
        return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
function buildLinkBlockHtml(links, provider) {
    if (links.length === 0)
        return '';
    const label = PROVIDER_LABEL[provider];
    const heading = links.length === 1
        ? `1 file shared via ${label}`
        : `${links.length} files shared via ${label}`;
    const rows = links
        .map((l) => {
        const size = formatBytes(l.size);
        return ('<div style="padding:6px 0;">' +
            `<a href="${escapeHtml(l.url)}" style="color:#0b66c3;text-decoration:none;font-weight:600;">${escapeHtml(l.name)}</a>` +
            (size
                ? `<span style="color:#5f6368;font-size:12px;"> &nbsp;${escapeHtml(size)}</span>`
                : '') +
            '</div>');
    })
        .join('');
    return ('<div style="margin-top:16px;padding:12px 16px;border:1px solid #dadce0;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">' +
        `<div style="color:#5f6368;font-size:12px;margin-bottom:4px;">${escapeHtml(heading)}</div>` +
        rows +
        '</div>');
}
function buildLinkBlockText(links, provider) {
    if (links.length === 0)
        return '';
    const label = PROVIDER_LABEL[provider];
    const heading = links.length === 1
        ? `1 file shared via ${label}:`
        : `${links.length} files shared via ${label}:`;
    const rows = links.map((l) => {
        const size = formatBytes(l.size);
        return `${l.name}${size ? ` (${size})` : ''}\n${l.url}`;
    });
    return `\n\n${heading}\n${rows.join('\n')}`;
}
const FORWARD_MARKER = /<div[^>]*data-cyg-forward/i;
function appendLinkBlock(body, bodyHtml, links, provider) {
    if (links.length === 0)
        return { body, bodyHtml };
    const htmlBlock = buildLinkBlockHtml(links, provider);
    let nextHtml = bodyHtml;
    if (bodyHtml) {
        const at = bodyHtml.search(FORWARD_MARKER);
        nextHtml =
            at === -1
                ? `${bodyHtml}${htmlBlock}`
                : bodyHtml.slice(0, at) + htmlBlock + bodyHtml.slice(at);
    }
    return {
        body: `${body ?? ''}${buildLinkBlockText(links, provider)}`,
        bodyHtml: nextHtml,
    };
}
//# sourceMappingURL=link-attachments.util.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toIsoCountry = toIsoCountry;
exports.isValidAreaCode = isValidAreaCode;
exports.isE164 = isE164;
exports.areaCodeOf = areaCodeOf;
exports.parseAvailableNumbers = parseAvailableNumbers;
exports.parsePurchasedNumber = parsePurchasedNumber;
exports.parseOwnedNumbers = parseOwnedNumbers;
exports.signalwireErrorMessage = signalwireErrorMessage;
function toIsoCountry(country) {
    switch ((country ?? '').trim().toUpperCase()) {
        case 'USA':
        case 'US':
            return 'US';
        case 'CANADA':
        case 'CA':
            return 'CA';
        default:
            return null;
    }
}
function isValidAreaCode(value) {
    return /^[2-9]\d{2}$/.test((value ?? '').trim());
}
function isE164(value) {
    return /^\+[1-9]\d{7,14}$/.test((value ?? '').trim());
}
function areaCodeOf(e164) {
    const m = /^\+1(\d{3})\d{7}$/.exec((e164 ?? '').trim());
    return m ? m[1] : null;
}
function capabilityOf(caps, name) {
    if (!caps || typeof caps !== 'object')
        return null;
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(caps)) {
        if (key.toLowerCase() === wanted) {
            return typeof value === 'boolean' ? value : null;
        }
    }
    return null;
}
function str(value) {
    return typeof value === 'string' && value !== '' ? value : null;
}
function parseAvailableNumbers(data) {
    const list = data?.['available_phone_numbers'];
    if (!Array.isArray(list))
        return [];
    const out = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object')
            continue;
        const row = raw;
        const phoneNumber = str(row.phone_number);
        if (!phoneNumber || !isE164(phoneNumber))
            continue;
        out.push({
            phoneNumber,
            friendlyName: str(row.friendly_name),
            region: str(row.region),
            rateCenter: str(row.rate_center),
            locality: str(row.locality),
            voice: capabilityOf(row.capabilities, 'voice') === true,
            sms: capabilityOf(row.capabilities, 'sms') === true,
            mms: capabilityOf(row.capabilities, 'mms') === true,
        });
    }
    return out;
}
function parsePurchasedNumber(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return null;
    const row = data;
    const sid = str(row.sid);
    const phoneNumber = str(row.phone_number);
    if (!sid || !phoneNumber)
        return null;
    return {
        sid,
        phoneNumber,
        friendlyName: str(row.friendly_name),
        voiceUrl: str(row.voice_url),
        smsUrl: str(row.sms_url),
        voice: capabilityOf(row.capabilities, 'voice'),
        sms: capabilityOf(row.capabilities, 'sms'),
        mms: capabilityOf(row.capabilities, 'mms'),
        capabilitiesRaw: row.capabilities === undefined ? null : JSON.stringify(row.capabilities),
    };
}
function parseOwnedNumbers(data) {
    const list = data?.['incoming_phone_numbers'];
    if (!Array.isArray(list))
        return [];
    return list
        .map((row) => parsePurchasedNumber(row))
        .filter((n) => n !== null);
}
function signalwireErrorMessage(data, raw) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const row = data;
        const message = str(row.message);
        const code = row.code;
        const codeText = typeof code === 'number' || typeof code === 'string'
            ? String(code)
            : null;
        if (message)
            return codeText ? `${message} (code ${codeText})` : message;
    }
    const trimmed = (raw ?? '').trim();
    return trimmed ? trimmed.slice(0, 300) : 'empty response body';
}
//# sourceMappingURL=signalwire-parse.js.map
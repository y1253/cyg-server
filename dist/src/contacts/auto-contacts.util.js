"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_SOURCES = void 0;
exports.desiredAutoContacts = desiredAutoContacts;
exports.AUTO_SOURCES = ['OWNER', 'STORE', 'ACCOUNTANT'];
const blank = (v) => !v || !v.trim();
function desiredAutoContacts(input) {
    const seeds = [];
    const { contactInfo: contact, accountant } = input;
    if (contact && !blank(contact.privatePhone)) {
        seeds.push({
            autoSource: 'OWNER',
            name: blank(contact.personalName) ? 'Owner' : contact.personalName.trim(),
            phone: contact.privatePhone.trim(),
        });
    }
    if (contact && !blank(contact.storeNumber)) {
        seeds.push({
            autoSource: 'STORE',
            name: 'Store',
            phone: contact.storeNumber.trim(),
        });
    }
    if (accountant && !blank(accountant.phone)) {
        seeds.push({
            autoSource: 'ACCOUNTANT',
            name: blank(accountant.name) ? 'Accountant' : accountant.name.trim(),
            phone: accountant.phone.trim(),
        });
    }
    return seeds;
}
//# sourceMappingURL=auto-contacts.util.js.map
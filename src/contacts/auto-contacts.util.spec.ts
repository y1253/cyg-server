import { desiredAutoContacts } from './auto-contacts.util.js';

const owner = (over = {}) => ({
  personalName: 'Dana Fisher',
  privatePhone: '(438) 256-1210',
  storeNumber: null,
  ...over,
});

describe('desiredAutoContacts', () => {
  it('turns the owner, the store and the accountant into three seeds', () => {
    expect(
      desiredAutoContacts({
        contactInfo: owner({ storeNumber: '438-555-0100' }),
        accountant: { name: 'Sam Ortiz', phone: '5145550199' },
      }),
    ).toEqual([
      { autoSource: 'OWNER', name: 'Dana Fisher', phone: '(438) 256-1210' },
      { autoSource: 'STORE', name: 'Store', phone: '438-555-0100' },
      { autoSource: 'ACCOUNTANT', name: 'Sam Ortiz', phone: '5145550199' },
    ]);
  });

  it('omits a source with no phone — that is what retires its row', () => {
    expect(
      desiredAutoContacts({
        contactInfo: owner({ privatePhone: null }),
        accountant: { name: 'Sam Ortiz', phone: null },
      }),
    ).toEqual([]);
  });

  it('treats whitespace as absent, not as a phone number', () => {
    expect(
      desiredAutoContacts({
        contactInfo: owner({ privatePhone: '   ' }),
        accountant: null,
      }),
    ).toEqual([]);
  });

  it('falls back to a generic label rather than an empty name', () => {
    // The whole point of the row is to put a WORD on an incoming call.
    expect(
      desiredAutoContacts({
        contactInfo: owner({ personalName: null }),
        accountant: { name: '  ', phone: '5145550199' },
      }),
    ).toEqual([
      { autoSource: 'OWNER', name: 'Owner', phone: '(438) 256-1210' },
      { autoSource: 'ACCOUNTANT', name: 'Accountant', phone: '5145550199' },
    ]);
  });

  it('never labels the store line with the owner, who is not answering it', () => {
    const [store] = desiredAutoContacts({
      contactInfo: { personalName: 'Dana Fisher', privatePhone: null, storeNumber: '4385550100' },
      accountant: null,
    });
    expect(store).toEqual({ autoSource: 'STORE', name: 'Store', phone: '4385550100' });
  });

  it('survives a company with neither section filled in', () => {
    expect(desiredAutoContacts({ contactInfo: null, accountant: null })).toEqual([]);
  });

  it('trims what it stores, so a stray space cannot split one person into two rows', () => {
    expect(
      desiredAutoContacts({
        contactInfo: owner({ personalName: '  Dana Fisher  ', privatePhone: ' 4382561210 ' }),
        accountant: null,
      }),
    ).toEqual([{ autoSource: 'OWNER', name: 'Dana Fisher', phone: '4382561210' }]);
  });
});

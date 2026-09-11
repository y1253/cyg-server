/**
 * Which contacts a company's OWN fields imply, and what they should say.
 *
 * Pure, so the rule that decides "the accountant's phone is a contact called <their name>"
 * is one testable function rather than something spelled out once in `register`, again in
 * `update`, and a third time in the backfill script. `ContactsService.syncAutoContacts`
 * applies it; `scripts/backfill-contacts.ts` applies the same function to existing rows.
 */

/**
 * The company field a seeded contact came from, and half of `Contact`'s unique key.
 *
 * Values are stored in the database, so they are append-only: renaming one orphans every
 * row already carrying the old string, which then never updates and never deletes.
 */
export const AUTO_SOURCES = ['OWNER', 'STORE', 'ACCOUNTANT'] as const;
export type AutoSource = (typeof AUTO_SOURCES)[number];

export interface AutoContactSeed {
  autoSource: AutoSource;
  name: string;
  phone: string;
}

/** Just the company fields this rule reads — so callers can `select` exactly these. */
export interface AutoContactInput {
  contactInfo: {
    personalName: string | null;
    privatePhone: string | null;
    storeNumber: string | null;
  } | null;
  accountant: { name: string | null; phone: string | null } | null;
}

const blank = (v: string | null | undefined): boolean => !v || !v.trim();

/**
 * The auto contacts this company SHOULD have, in a stable order.
 *
 * A source with no phone is simply absent from the result, and the caller deletes any row
 * for it — which is what makes clearing the accountant's phone on the Details tab remove
 * the contact rather than strand a number nobody answers any more.
 *
 * The name falls back to a generic label rather than being left empty, because the whole
 * point of the row is to put a WORD on an incoming call. "Accountant" is a useful thing to
 * see ringing; a blank name is not.
 */
export function desiredAutoContacts(input: AutoContactInput): AutoContactSeed[] {
  const seeds: AutoContactSeed[] = [];
  const { contactInfo: contact, accountant } = input;

  if (contact && !blank(contact.privatePhone)) {
    seeds.push({
      autoSource: 'OWNER',
      name: blank(contact.personalName) ? 'Owner' : contact.personalName!.trim(),
      phone: contact.privatePhone!.trim(),
    });
  }

  if (contact && !blank(contact.storeNumber)) {
    seeds.push({
      autoSource: 'STORE',
      // Deliberately NOT the owner's name: this is the shop's line, and labelling it with
      // a person means an inbound call from the counter claims to be them.
      name: 'Store',
      phone: contact.storeNumber!.trim(),
    });
  }

  if (accountant && !blank(accountant.phone)) {
    seeds.push({
      autoSource: 'ACCOUNTANT',
      name: blank(accountant.name) ? 'Accountant' : accountant.name!.trim(),
      phone: accountant.phone!.trim(),
    });
  }

  return seeds;
}

import { sayAndHangup } from '../phone/laml.util';
import { PLACEHOLDERS, renderMessage } from './phone-message.util';

const VARS = {
  company: 'Acme Bookkeeping',
  phone: '+14382561210',
  hours: '9 AM to 5 PM',
};

describe('renderMessage', () => {
  it('substitutes {company name} — with the space, which is what admins actually type', () => {
    expect(
      renderMessage("You've reached {company name}, managed by Cyg Finance.", VARS),
    ).toBe("You've reached Acme Bookkeeping, managed by Cyg Finance.");
  });

  it('accepts every spelling of the company token', () => {
    for (const token of [
      '{company}',
      '{company name}',
      '{companyName}',
      '{ Company Name }',
      '{COMPANY NAME}',
    ]) {
      expect(renderMessage(token, VARS)).toBe('Acme Bookkeeping');
    }
  });

  it('substitutes the phone and hours tokens', () => {
    expect(renderMessage('Call {phone}. We are open {hours}.', VARS)).toBe(
      'Call +14382561210. We are open 9 AM to 5 PM.',
    );
  });

  it('replaces every occurrence, not just the first', () => {
    expect(renderMessage('{company} and {company}', VARS)).toBe(
      'Acme Bookkeeping and Acme Bookkeeping',
    );
  });

  it('leaves an unknown placeholder VERBATIM', () => {
    // An admin who types {comapny} must hear their own typo, not silence. A blanked
    // token is an invisible bug on a live client-facing line.
    expect(renderMessage('Hello {comapny}, welcome', VARS)).toBe(
      'Hello {comapny}, welcome',
    );
  });

  it('does not re-expand a substituted value — one pass, not sequential passes', () => {
    // A company genuinely named "{phone} Ltd" must not have its own name expanded.
    expect(renderMessage('Welcome to {company}', { ...VARS, company: '{phone} Ltd' })).toBe(
      'Welcome to {phone} Ltd',
    );
  });

  it('renders a missing var as empty, never the string "undefined"', () => {
    const partial = { company: '', phone: '', hours: '' };
    expect(renderMessage('[{company}]', partial)).toBe('[]');
  });

  it('returns empty for a non-string template rather than throwing', () => {
    expect(renderMessage(undefined as unknown as string, VARS)).toBe('');
  });

  it('leaves the message unchanged when it has no placeholders', () => {
    expect(renderMessage('Please hold.', VARS)).toBe('Please hold.');
  });
});

describe('escaping happens once, downstream', () => {
  it('adds no XML escaping of its own', () => {
    // This module produces PLAIN text; laml.util.ts owns escaping.
    expect(renderMessage('{company}', { ...VARS, company: "O'Brien & Sons" })).toBe(
      "O'Brien & Sons",
    );
  });

  it('escapes exactly once by the time it reaches <Say>', () => {
    // Escaping on both sides yields O&amp;apos;Brien, which SignalWire reads out to the
    // caller entity by entity.
    const xml = sayAndHangup(
      renderMessage('{company name}', { ...VARS, company: "O'Brien Bookkeeping" }),
    );
    expect(xml).toContain('<Say>O&apos;Brien Bookkeeping</Say>');
    expect(xml).not.toContain('&amp;apos;');
  });
});

describe('PLACEHOLDERS', () => {
  it('lists tokens that renderMessage actually substitutes', () => {
    // The client renders its insertable chips from this array, so a token listed here
    // and not understood by the renderer would print literally on a live call.
    for (const { token } of PLACEHOLDERS) {
      expect(renderMessage(token, VARS)).not.toBe(token);
    }
  });
});

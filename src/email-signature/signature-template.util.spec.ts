import {
  PLACEHOLDERS,
  escapeHtml,
  renderSignature,
  sanitizeSignatureHtml,
  type SignatureVars,
} from './signature-template.util';

const VARS: SignatureVars = {
  company: 'Acme Bookkeeping',
  phone: '+14382561210',
  email: 'billing@acme.com',
  accountant: 'Dana Levy',
  accountantemail: 'dana@cygfinance.com',
  accountantphone: '+15145550100',
  logoUrl: null,
};

describe('renderSignature — token substitution', () => {
  it('accepts every spelling of the company token', () => {
    for (const t of [
      '{company name}',
      '{companyName}',
      '{company}',
      '{ Company Name }',
      '{BUSINESS NAME}',
    ]) {
      expect(renderSignature(t, VARS)).toBe('Acme Bookkeeping');
    }
  });

  it('substitutes every token PLACEHOLDERS advertises', () => {
    // The drift guard: a chip offered to an admin that renderSignature does not
    // understand would print literally in every outgoing email.
    for (const p of PLACEHOLDERS) {
      const out = renderSignature(p.token, {
        ...VARS,
        logoUrl: 'https://example.test/logo.png',
      });
      expect(out).not.toBe(p.token);
    }
  });

  it('leaves an unknown token VERBATIM', () => {
    // An admin who types {comapny} must see their own typo, not silence.
    expect(renderSignature('{comapny}', VARS)).toBe('{comapny}');
  });

  it('renders a missing var as empty, never "undefined"', () => {
    expect(
      renderSignature('[{support number}]', { ...VARS, phone: '' }),
    ).toBe('[]');
  });

  it('returns "" for a non-string template', () => {
    expect(renderSignature(undefined as unknown as string, VARS)).toBe('');
  });

  it('does NOT re-expand a value that itself looks like a token', () => {
    // One .replace() pass. Sequential passes would expand this again.
    const out = renderSignature('{company name}', {
      ...VARS,
      company: '{support number} Ltd',
    });
    expect(out).toBe('{support number} Ltd');
    expect(out).not.toContain('+14382561210');
  });
});

describe('renderSignature — escaping (the rule that INVERTS from the phone side)', () => {
  it('escapes a substituted value exactly once', () => {
    const out = renderSignature('<div>{company name}</div>', {
      ...VARS,
      company: 'Smith & Sons',
    });
    expect(out).toBe('<div>Smith &amp; Sons</div>');
    // Double-escaping is the failure mode phone-message.util.ts documents in the other
    // direction; it would render as literal "&amp;" text in the recipient's client.
    expect(out).not.toContain('&amp;amp;');
  });

  it('neutralises markup arriving through a company name', () => {
    const out = renderSignature('{company name}', {
      ...VARS,
      company: '<script>alert(1)</script>',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes quotes, so a value cannot break out of an attribute', () => {
    const out = renderSignature('<a title="{company name}">x</a>', {
      ...VARS,
      company: 'A" onmouseover="evil()',
    });
    expect(out).not.toContain('onmouseover="evil()"');
    expect(out).toContain('&quot;');
  });

  it('leaves the admin\'s own template markup untouched', () => {
    // The template is deliberately rich HTML. Escaping it too would show an admin their
    // own tags as text in every email.
    const out = renderSignature('<b>Bold</b><br>{company name}', VARS);
    expect(out).toBe('<b>Bold</b><br>Acme Bookkeeping');
  });
});

describe('renderSignature — {logo}', () => {
  it('renders nothing when no logo is set', () => {
    expect(renderSignature('a{logo}b', VARS)).toBe('ab');
  });

  it('renders one bounded img when a logo is set', () => {
    const out = renderSignature('{logo}', {
      ...VARS,
      logoUrl: 'https://example.test/l.png',
    });
    expect(out).toContain('<img src="https://example.test/l.png"');
    expect(out).toContain('max-width:180px');
  });

  it('escapes the url, so it cannot close the attribute', () => {
    const out = renderSignature('{logo}', {
      ...VARS,
      logoUrl: 'https://x/"onerror="evil()',
    });
    expect(out).not.toContain('onerror="evil()"');
  });
});

describe('escapeHtml', () => {
  it('covers the five characters that matter in markup', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('sanitizeSignatureHtml', () => {
  it('removes script and style blocks with their contents', () => {
    expect(sanitizeSignatureHtml('a<script>evil()</script>b')).toBe('ab');
    expect(sanitizeSignatureHtml('a<style>*{}</style>b')).toBe('ab');
  });

  it('removes iframes and embedded objects', () => {
    expect(sanitizeSignatureHtml('<iframe src="x"></iframe>ok')).toBe('ok');
  });

  it('strips event handlers, quoted or bare', () => {
    expect(sanitizeSignatureHtml('<img src="x" onerror="evil()">')).toBe(
      '<img src="x">',
    );
    expect(sanitizeSignatureHtml('<div onclick=evil()>x</div>')).toBe(
      '<div>x</div>',
    );
  });

  it('strips javascript: urls', () => {
    expect(sanitizeSignatureHtml('<a href="javascript:evil()">x</a>')).toBe(
      '<a>x</a>',
    );
  });

  it('leaves ordinary signature markup alone', () => {
    const html =
      '<div style="font-size:0.85em">managed by ' +
      '<a href="https://cygfinance.com">CYG FINANCE</a></div>';
    expect(sanitizeSignatureHtml(html)).toBe(html);
  });

  it('returns "" for a non-string', () => {
    expect(sanitizeSignatureHtml(null as unknown as string)).toBe('');
  });
});

import { attachmentNameParams } from './attachment-name.util';

describe('attachmentNameParams', () => {
  it('passes an ASCII filename through with no filename* param', () => {
    expect(attachmentNameParams('invoice.pdf')).toEqual({
      asciiName: 'invoice.pdf',
      filenameParam: '',
    });
  });

  it('falls back to attachment.<ext> + RFC 2231 filename* for non-ASCII', () => {
    const { asciiName, filenameParam } = attachmentNameParams('חשבונית.pdf');
    expect(asciiName).toBe('attachment.pdf');
    expect(filenameParam).toBe(
      `; filename*=UTF-8''${encodeURIComponent('חשבונית.pdf')}`,
    );
    // The percent-encoded name must decode back to the original.
    const encoded = /filename\*=UTF-8''(.+)$/.exec(filenameParam)![1];
    expect(decodeURIComponent(encoded)).toBe('חשבונית.pdf');
  });

  it('sanitises quotes/CRLF that would break the quoted-string param', () => {
    expect(attachmentNameParams('a"b\r\nc.txt').asciiName).toBe('a_b__c.txt');
  });

  it('defaults a missing filename', () => {
    expect(attachmentNameParams('').asciiName).toBe('attachment');
  });

  // The download path slices filenames to 255 chars, which can cut an emoji in
  // half. encodeURIComponent throws URIError on a lone surrogate, which would be
  // a 500 all over again — the exact failure this helper exists to prevent.
  it('survives a filename cut mid-surrogate-pair', () => {
    const cut = 'screenshot 🎉'.slice(0, -1) + '.png';
    expect(() => attachmentNameParams(cut)).not.toThrow();
    const { filenameParam } = attachmentNameParams(cut);
    expect(filenameParam).not.toContain('%ED%A0'); // no encoded lone surrogate
  });

  it('keeps a complete emoji intact', () => {
    const { filenameParam } = attachmentNameParams('party 🎉.png');
    const encoded = /filename\*=UTF-8''(.+)$/.exec(filenameParam)![1];
    expect(decodeURIComponent(encoded)).toBe('party 🎉.png');
  });
});

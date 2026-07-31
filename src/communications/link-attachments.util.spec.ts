import {
  appendLinkBlock,
  buildLinkBlockHtml,
  buildLinkBlockText,
  formatBytes,
} from './link-attachments.util';

const link = (name: string, url = 'https://drive.google.com/file/d/abc/view') => ({
  name,
  size: 60 * 1024 * 1024,
  url,
});

describe('formatBytes', () => {
  it('formats whole and fractional units', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(60 * 1024 * 1024)).toBe('60 MB');
  });

  it('returns an empty string for a missing size', () => {
    expect(formatBytes(0)).toBe('');
  });
});

describe('buildLinkBlockHtml', () => {
  it('is empty when nothing was linked', () => {
    expect(buildLinkBlockHtml([], 'drive')).toBe('');
  });

  it('names the provider and pluralises the count', () => {
    expect(buildLinkBlockHtml([link('a.mp4')], 'drive')).toContain(
      '1 file shared via Google Drive',
    );
    expect(
      buildLinkBlockHtml([link('a.mp4'), link('b.mp4')], 'onedrive'),
    ).toContain('2 files shared via OneDrive');
  });

  it('renders the filename, size and url', () => {
    const html = buildLinkBlockHtml([link('quarterly report.pdf')], 'drive');
    expect(html).toContain('quarterly report.pdf');
    expect(html).toContain('60 MB');
    expect(html).toContain('href="https://drive.google.com/file/d/abc/view"');
  });

  it('escapes a hostile filename rather than emitting markup', () => {
    const html = buildLinkBlockHtml(
      [link('<img src=x onerror=alert(1)>.png')],
      'drive',
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes quotes in the url so it cannot break out of the attribute', () => {
    const html = buildLinkBlockHtml(
      [link('a.pdf', 'https://x.test/"><script>alert(1)</script>')],
      'drive',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});

describe('buildLinkBlockText', () => {
  it('lists each file on its own line with the url below it', () => {
    const text = buildLinkBlockText([link('clip.mp4')], 'onedrive');
    expect(text).toContain('1 file shared via OneDrive:');
    expect(text).toContain('clip.mp4 (60 MB)');
    expect(text).toContain('https://drive.google.com/file/d/abc/view');
  });

  it('is empty when nothing was linked', () => {
    expect(buildLinkBlockText([], 'drive')).toBe('');
  });
});

describe('appendLinkBlock', () => {
  it('returns the body untouched when nothing was linked', () => {
    const result = appendLinkBlock('hello', '<p>hello</p>', [], 'drive');
    expect(result).toEqual({ body: 'hello', bodyHtml: '<p>hello</p>' });
  });

  it('appends to both the text and html bodies', () => {
    const result = appendLinkBlock(
      'hello',
      '<p>hello</p>',
      [link('clip.mp4')],
      'drive',
    );
    expect(result.body.startsWith('hello')).toBe(true);
    expect(result.body).toContain('clip.mp4');
    expect(result.bodyHtml?.startsWith('<p>hello</p>')).toBe(true);
    expect(result.bodyHtml).toContain('Google Drive');
  });

  it('leaves bodyHtml undefined for a plain-text message', () => {
    const result = appendLinkBlock('hello', undefined, [link('a.mp4')], 'drive');
    expect(result.bodyHtml).toBeUndefined();
    expect(result.body).toContain('a.mp4');
  });
});

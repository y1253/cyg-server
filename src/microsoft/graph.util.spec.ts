import {
  chatDisplayName,
  chatSpaceType,
  formatGraphAddress,
  htmlToText,
  teamsStateId,
  TEAMS_PREFIX,
  type GraphChat,
} from './graph.util.js';

describe('graph.util', () => {
  describe('teamsStateId (id-collision safety)', () => {
    it('namespaces Teams message ids with the msteams: prefix', () => {
      const id = teamsStateId('19:abc@thread.v2', '1616964509832');
      expect(id).toBe('msteams:19:abc@thread.v2:1616964509832');
      expect(id.startsWith(TEAMS_PREFIX)).toBe(true);
    });

    it('never collides with a plain Outlook email id', () => {
      // Outlook message ids are long opaque strings WITHOUT the msteams: prefix, so
      // the completed-set filter (`!id.startsWith('msteams:')`) cleanly separates
      // email ids from chat ids in the shared MessageCompletedState table.
      const outlookId = 'AAMkAGI2TG93AAA=';
      const teamsId = teamsStateId('19:xyz@thread.v2', '1700000000000');
      expect(outlookId.startsWith(TEAMS_PREFIX)).toBe(false);
      expect(teamsId.startsWith(TEAMS_PREFIX)).toBe(true);
      expect(outlookId).not.toEqual(teamsId);
    });
  });

  describe('htmlToText', () => {
    it('collapses Teams HTML bodies to readable text', () => {
      expect(htmlToText('<p>Hello</p><p>World</p>')).toBe('Hello\nWorld');
      expect(htmlToText('a<br>b')).toBe('a\nb');
      expect(htmlToText('&lt;tag&gt; &amp; more')).toBe('<tag> & more');
      expect(htmlToText(null)).toBe('');
    });
  });

  describe('formatGraphAddress', () => {
    it('formats "Name <email>" and falls back to the bare address', () => {
      expect(
        formatGraphAddress({
          emailAddress: { name: 'Jane Doe', address: 'jane@x.com' },
        }),
      ).toBe('Jane Doe <jane@x.com>');
      expect(
        formatGraphAddress({
          emailAddress: { name: 'jane@x.com', address: 'jane@x.com' },
        }),
      ).toBe('jane@x.com');
      expect(formatGraphAddress(undefined)).toBe('');
    });
  });

  describe('chatDisplayName', () => {
    const self = 'me-oid';
    it('uses the topic when present', () => {
      const chat = {
        id: '1',
        topic: 'Project X',
        chatType: 'group',
      } as GraphChat;
      expect(chatDisplayName(chat, self)).toBe('Project X');
    });
    it('uses the other members names for a 1:1 with no topic', () => {
      const chat = {
        id: '1',
        chatType: 'oneOnOne',
        members: [
          { userId: self, displayName: 'Me' },
          { userId: 'other', displayName: 'Alice' },
        ],
      } as GraphChat;
      expect(chatDisplayName(chat, self)).toBe('Alice');
    });
  });

  describe('chatSpaceType', () => {
    it('maps oneOnOne to DIRECT_MESSAGE and others to SPACE', () => {
      expect(chatSpaceType('oneOnOne')).toBe('DIRECT_MESSAGE');
      expect(chatSpaceType('group')).toBe('SPACE');
      expect(chatSpaceType(undefined)).toBe('SPACE');
    });
  });
});

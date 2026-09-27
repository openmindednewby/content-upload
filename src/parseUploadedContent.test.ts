import { parseUploadedContent } from './parseUploadedContent';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

function kindOf(fn: () => unknown): UploadErrorKind | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof UploadError ? e.kind : undefined;
  }
  return undefined;
}

describe('parseUploadedContent', () => {
  it('accepts the Dloizides.Content.Upload.AspNetCore proxy body, which has no status (KEFI-PEOPLE-1)', () => {
    // ContentUploadResponse(ContentId, Url): the organizer upload route returns 201 with only these two.
    expect(parseUploadedContent('{"contentId":"a","url":"https://cdn/a.png"}', true)).toEqual({ contentId: 'a', url: 'https://cdn/a.png' });
  });

  it('parses contentId, status and url', () => {
    expect(parseUploadedContent('{"contentId":"a","status":"Active","url":"u"}', true)).toEqual({ contentId: 'a', status: 'Active', url: 'u' });
  });

  it.each([
    ['not json', 'nope'],
    ['null', 'null'],
    ['array', '[]'],
    ['missing contentId', '{"status":"Active"}'],
    ['non-string status', '{"contentId":"a","status":1}'],
  ])('rejects %s as InvalidResponse', (_label, text) => {
    expect(kindOf(() => parseUploadedContent(text, false))).toBe(UploadErrorKind.InvalidResponse);
  });

  it('treats an empty or non-string url as missing', () => {
    expect(parseUploadedContent('{"contentId":"a","status":"s","url":""}', false).url).toBeUndefined();
    expect(parseUploadedContent('{"contentId":"a","status":"s","url":5}', false).url).toBeUndefined();
    expect(kindOf(() => parseUploadedContent('{"contentId":"a","status":"s","url":""}', true))).toBe(UploadErrorKind.InvalidResponse);
  });
});

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  EMBED_LOAD_FILE_MESSAGE,
  LOCAL_HANDOFF_FILE_MESSAGE,
  LOCAL_HANDOFF_READY_MESSAGE,
  createLocalFileHandoffId,
  isEmbedLoadFileMessage,
  isLocalFileHandoffFileMessage,
  isLocalFileHandoffReadyMessage
} from '../src/embed/local-file-handoff';

describe('local file handoff messages', () => {
  it('validates wrapper-to-embed local file messages', () => {
    const file = new File(['pixels'], 'beauty.exr');

    expect(isEmbedLoadFileMessage({
      type: EMBED_LOAD_FILE_MESSAGE,
      file
    })).toBe(true);
    expect(isEmbedLoadFileMessage({
      type: EMBED_LOAD_FILE_MESSAGE,
      file: {}
    })).toBe(false);
  });

  it('validates local full-window handoff messages', () => {
    const file = new File(['pixels'], 'beauty.exr');

    expect(isLocalFileHandoffReadyMessage({
      type: LOCAL_HANDOFF_READY_MESSAGE,
      id: 'abc'
    })).toBe(true);
    expect(isLocalFileHandoffFileMessage({
      type: LOCAL_HANDOFF_FILE_MESSAGE,
      id: 'abc',
      file,
      state: {
        viewerMode: 'image'
      }
    })).toBe(true);
    expect(isLocalFileHandoffFileMessage({
      type: LOCAL_HANDOFF_FILE_MESSAGE,
      id: 'abc',
      file: 'not a file'
    })).toBe(false);
  });

  it('creates non-empty handoff IDs', () => {
    expect(createLocalFileHandoffId()).toEqual(expect.any(String));
    expect(createLocalFileHandoffId().length).toBeGreaterThan(4);
  });
});

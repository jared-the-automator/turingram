import { describe, it, expect } from 'vitest';
import { parseAvfoundationAudioDevices, macSystemAudioWarning } from '../audio/mac';

// Captured shape of `ffmpeg -f avfoundation -list_devices true -i ""`. The video
// section is here on purpose: it uses the same `[N] Name` lines as the audio one,
// so a parser that ignores the headers returns a camera as a microphone.
const LISTING = `
[AVFoundation indev @ 0x7f8e1c008200] AVFoundation video devices:
[AVFoundation indev @ 0x7f8e1c008200] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8e1c008200] [1] Capture screen 0
[AVFoundation indev @ 0x7f8e1c008200] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8e1c008200] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x7f8e1c008200] [1] Jabra SPEAK 410 USB
: Immediate exit requested
`;

describe('parseAvfoundationAudioDevices', () => {
  it('reads only the audio section', () => {
    const devices = parseAvfoundationAudioDevices(LISTING);
    expect(devices.map(d => d.name)).toEqual(['MacBook Pro Microphone', 'Jabra SPEAK 410 USB']);
  });

  it('keeps the avfoundation index as the id, since that is what -i wants', () => {
    expect(parseAvfoundationAudioDevices(LISTING).map(d => d.id)).toEqual(['0', '1']);
  });

  it('marks index 0 default, matching what the app recorded before a picker existed', () => {
    const devices = parseAvfoundationAudioDevices(LISTING);
    expect(devices.filter(d => d.isDefault).map(d => d.name)).toEqual(['MacBook Pro Microphone']);
  });

  it('never returns a video device, even when the indices collide', () => {
    const names = parseAvfoundationAudioDevices(LISTING).map(d => d.name);
    expect(names).not.toContain('FaceTime HD Camera');
    expect(names).not.toContain('Capture screen 0');
  });

  it('handles a build that logs without the [AVFoundation indev] prefix', () => {
    const bare = 'AVFoundation audio devices:\n[0] Built-in Microphone\n';
    expect(parseAvfoundationAudioDevices(bare)).toEqual([
      { id: '0', name: 'Built-in Microphone', isDefault: true },
    ]);
  });

  it('returns nothing rather than throwing when ffmpeg printed no list at all', () => {
    expect(parseAvfoundationAudioDevices('')).toEqual([]);
    expect(parseAvfoundationAudioDevices('ffmpeg: command not found')).toEqual([]);
  });

  it('keeps device names containing brackets or digits intact', () => {
    const odd = 'AVFoundation audio devices:\n[0] Scarlett 2i2 [USB]\n';
    expect(parseAvfoundationAudioDevices(odd)[0].name).toBe('Scarlett 2i2 [USB]');
  });
});

describe('macSystemAudioWarning', () => {
  it('blames the permission when the helper shipped but produced nothing', () => {
    const msg = macSystemAudioWarning(true, '');
    expect(msg).toContain('Screen Recording');
    expect(msg).not.toContain('packaging bug');
  });

  it('blames the build when the helper is missing, since no setting fixes that', () => {
    const msg = macSystemAudioWarning(false, '');
    expect(msg).toContain('packaging bug');
    expect(msg).not.toContain('Screen Recording');
  });

  it('says everyone appears as one speaker, which is the symptom to expect', () => {
    expect(macSystemAudioWarning(true, '')).toContain('one speaker');
  });

  it('appends the helper last line, which is what says why SCStream gave up', () => {
    const msg = macSystemAudioWarning(true, 'starting SCStream\nSCStream failed: TCC denied\n');
    expect(msg).toContain('SCStream failed: TCC denied');
    expect(msg).not.toContain('starting SCStream');
  });

  it('reads cleanly when the helper said nothing', () => {
    expect(macSystemAudioWarning(true, '   \n\n')).not.toContain('()');
  });
});

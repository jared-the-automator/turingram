import { describe, it, expect } from 'vitest';
import { opensExternally } from '../externalLinks';
import { TIERS } from '../drinks';

describe('opensExternally', () => {
  it('opens the key pages and every drink checkout', () => {
    expect(opensExternally('https://console.deepgram.com/signup')).toBe(true);
    expect(opensExternally('https://aistudio.google.com/apikey')).toBe(true);
    for (const t of TIERS) expect(opensExternally(`${t.link}?client_reference_id=turingram_x`)).toBe(true);
  });

  it('refuses other hosts, other schemes and lookalikes', () => {
    for (const bad of [
      'https://example.com/',
      'http://buy.stripe.com/x',
      'file:///etc/passwd',
      'https://buy.stripe.com.evil.example/x',
      'https://evil.example/?https://buy.stripe.com',
      'https://user@buy.stripe.com/x',
      'not a url',
    ]) expect(opensExternally(bad)).toBe(false);
  });
});

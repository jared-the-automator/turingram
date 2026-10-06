// The only hosts the renderer may open in the user's browser: the two key
// pages Settings links to and the drink checkout. A transcript can carry any
// text, so the check reads the parsed host, never a string prefix.
const HOSTS = new Set(['console.deepgram.com', 'aistudio.google.com', 'buy.stripe.com']);

export function opensExternally(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

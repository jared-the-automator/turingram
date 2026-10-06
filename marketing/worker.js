// Every other hostname the Worker answers on redirects to turingram.com, so
// the site has one address. Everything else is a static asset from dist/.
const CANONICAL = 'turingram.com';
const REDIRECTED = new Set(['www.turingram.com', 'turingram.biggerfish.io']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (REDIRECTED.has(url.hostname)) {
      url.hostname = CANONICAL;
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};

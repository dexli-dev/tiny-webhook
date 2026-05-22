// Receive endpoint catch-all: /in/[token]/<any/sub/path>
//
// Delegates to the same handler as /in/[token] so subpaths are captured with
// their full pathname (e.g. "/in/abc123/sub/path").

export { GET, POST, PUT, PATCH, DELETE, OPTIONS } from '../+server';

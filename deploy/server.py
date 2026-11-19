#!/usr/bin/env python3
"""Static file server for SKYFOLD. Same as `python -m http.server`, but sends
Cache-Control: no-cache so phones and the Cloudflare edge always revalidate and
pick up new code right after a change."""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    handler = partial(NoCacheHandler, directory='/home/pi4/flying-game')
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()

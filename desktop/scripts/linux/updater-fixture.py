#!/usr/bin/env python3
"""Guest-only HTTPS release fixture. Never run as a host GitHub proxy.

The production updater, URLs, curl TLS verification and checksum/atomic install
path are unchanged. A guest-local CONNECT proxy terminates only the two names.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import ssl
import time

API = '/repos/tryapparent/apparent/releases/latest'


def response(control, path, payload):
    mode = control['mode']
    version = control['version'] if mode == 'current' else '999.0.0'
    name = f'Apparent-{version}-linux-x86_64.AppImage'
    prefix = f'/tryapparent/apparent/releases/download/v{version}/'
    if path == API:
        if mode == 'error':
            return 503, b'controlled fixture failure\n'
        return 200, json.dumps({'tag_name': 'v' + version, 'draft': False, 'prerelease': False,
                               'assets': [{'name': filename, 'browser_download_url': 'https://github.com' + prefix + filename}
                                          for filename in [name, name + '.sha256']]}).encode()
    if path == prefix + name + '.sha256':
        digest = '0' * 64 if mode == 'bad-checksum' else hashlib.sha256(payload).hexdigest()
        return 200, f'{digest}  {name}\n'.encode()
    if path == prefix + name:
        return 200, payload
    return 404, b'unexpected fixture route\n'


def serve(directory, payload, port=8443):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(directory / 'cert.pem', directory / 'key.pem')

    class Handler(BaseHTTPRequestHandler):
        def do_CONNECT(self):
            if self.path not in ('api.github.com:443', 'github.com:443'):
                self.send_error(403, 'fixture does not proxy other destinations')
                return
            self.send_response(200, 'Connection Established')
            self.end_headers()
            self.connection = context.wrap_socket(self.connection, server_side=True)
            self.rfile = self.connection.makefile('rb')
            self.wfile = self.connection.makefile('wb')
            self.close_connection = True
            self.handle_one_request()

        def do_GET(self):
            control = json.loads((directory / 'control.json').read_text())
            with (directory / 'requests.jsonl').open('a') as log:
                log.write(json.dumps({'time': time.time(), 'path': self.path, 'control': control}) + '\n')
            if self.path == API and control.get('gate'):
                (directory / 'request-started').touch()
                deadline = time.monotonic() + 30
                while not (directory / 'release-response').exists():
                    if time.monotonic() > deadline:
                        self.send_error(504, 'fixture gate was not released')
                        return
                    time.sleep(0.05)
            status, body = response(control, self.path, payload)
            self.send_response(status)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            if control['serial'] == 1 and self.path.endswith('.sha256'):
                (directory / 'startup-complete').touch()

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    (directory / 'server-ready').touch()
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('appimage', type=Path)
    parser.add_argument('--port', type=int, default=8443)
    args = parser.parse_args()
    serve(args.directory, args.appimage.read_bytes(), args.port)

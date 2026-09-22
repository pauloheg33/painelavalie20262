"""Configura/verifica o Pages usando a credencial Git existente, sem salvá-la."""
import argparse
import json
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPOSITORY = 'pauloheg33/painelavalie20262'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status','configure','build'])
    args = parser.parse_args()
    result = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n',
                            text=True, capture_output=True, check=True)
    credential = dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    token = credential.get('password')
    if not token:
        raise RuntimeError('Credencial GitHub indisponível')

    def api(path='', method='GET', body=None):
        request = Request(f'https://api.github.com/repos/{REPOSITORY}/pages{path}',
                          data=json.dumps(body).encode() if body is not None else None,
                          method=method, headers={'Authorization': f'Bearer {token}',
                          'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
                          'Content-Type':'application/json','User-Agent':'avalie-pages-deploy'})
        try:
            with urlopen(request, timeout=30) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except HTTPError as error:
            if error.code == 404:
                return {'not_found':True}
            raise RuntimeError(f'GitHub API: HTTP {error.code}: {error.read().decode()}') from None

    state = api()
    if args.action == 'configure':
        api(method='POST' if state.get('not_found') else 'PUT',
            body={'build_type':'legacy','source':{'branch':'main','path':'/docs'}})
        state = api()
    elif args.action == 'build':
        api('/builds',method='POST',body={})
    latest = api('/builds/latest') if not state.get('not_found') else {}
    print(json.dumps({'url':state.get('html_url'),'status':state.get('status'),
                      'source':state.get('source'),'not_found':state.get('not_found',False),
                      'build_status':latest.get('status'),'commit':latest.get('commit'),
                      'error':latest.get('error')},ensure_ascii=False))


if __name__ == '__main__':
    main()

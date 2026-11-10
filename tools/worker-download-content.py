"""Normalize Cloudflare's legacy JS or one-module multipart download; no secrets."""
import sys,re,email
from pathlib import Path
headers,source,target=map(Path,sys.argv[1:])
raw=source.read_bytes()
ctypes=re.findall(br'(?im)^content-type:\s*([^\r\n]+)',headers.read_bytes())
ctype=ctypes[-1] if ctypes else b''
if b'multipart/' in ctype.lower():
    msg=email.message_from_bytes(b'Content-Type: '+ctype+b'\r\nMIME-Version: 1.0\r\n\r\n'+raw)
    parts=[p for p in msg.walk() if not p.is_multipart()]
    if len(parts)!=1:raise SystemExit('Only a single JavaScript module is supported; refusing ambiguous backup')
    part=parts[0]; name=part.get_filename() or part.get_param('name',header='content-disposition') or ''
    raw=part.get_payload(decode=True)
    # Cloudflare omits filename and Content-Type on downloaded single-module parts.
    if 'javascript' not in part.get_content_type() and not (name.endswith(('.js','.mjs')) and re.search(br'^export default\b',raw,re.M)):
        raise SystemExit('JavaScript module missing from multipart backup')
    format='module'
else:
    format='module' if re.search(br'^export default\b',raw,re.M) else 'legacy'
if not raw or b'addEventListener' not in raw:raise SystemExit('Worker code missing from download')
target.write_bytes(raw)
print(format)

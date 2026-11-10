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
    if len(parts)!=1 or 'javascript' not in parts[0].get_content_type():
        raise SystemExit('Only a single JavaScript module is supported; refusing ambiguous backup')
    raw=parts[0].get_payload(decode=True)
    format='module'
else:
    format='module' if re.search(br'^export default\b',raw,re.M) else 'legacy'
if not raw or b'addEventListener' not in raw:raise SystemExit('Worker code missing from download')
target.write_bytes(raw)
print(format)

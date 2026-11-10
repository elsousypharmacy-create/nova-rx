from pathlib import Path
import tempfile,subprocess,sys
with tempfile.TemporaryDirectory() as d:
 p=Path(d);js=b"export default {fetch(){return new Response('ok')}}; // addEventListener adapter\n"
 (p/'headers').write_bytes(b'Content-Type: multipart/form-data; boundary=test-boundary\r\n')
 (p/'raw').write_bytes(b'--test-boundary\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'+js+b'\r\n--test-boundary--\r\n')
 args=[sys.executable,'tools/worker-download-content.py',str(p/'headers'),str(p/'raw'),str(p/'out')]
 assert subprocess.check_output(args).strip()==b'module';assert (p/'out').read_bytes()==js
 legacy=b"addEventListener('fetch',e=>e.respondWith(new Response('ok')));"
 (p/'headers').write_bytes(b'Content-Type: application/javascript\r\n');(p/'raw').write_bytes(legacy)
 assert subprocess.check_output(args).strip()==b'legacy';assert (p/'out').read_bytes()==legacy
 print('PASS Cloudflare download normalization: exact module multipart and legacy bytes for backup/read-back')

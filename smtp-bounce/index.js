import net from 'node:net';

const API_URL = process.env.API_INTERNAL_URL || 'http://sendemail-api:8096/api/v1/bounces/ingest';
const PORT = Number(process.env.SMTP_BOUNCE_PORT || 2525);

function parseBounce(verp, raw) {
  const code = (raw.match(/Status:\s*([245]\.\d+\.\d+)/i)?.[1]) || (raw.match(/\b(55[0-9]|45[0-9])\b/)?.[1]) || '5.1.1';
  const rcpt = (raw.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n<>]+)/i)?.[1]) || (raw.match(/Original-Recipient:\s*rfc822;\s*([^\s\r\n<>]+)/i)?.[1]) || '';
  const diag = (raw.match(/Diagnostic-Code:\s*([^\r\n]+)/i)?.[1]) || 'SMTP DSN bounce';
  const isFbl = /Feedback-Type:\s*abuse/i.test(raw);
  return { verp_address: verp, recipient_email: rcpt, source: isFbl ? 'isp_fbl' : 'verp_dsn', bounce_type: isFbl ? 'complaint' : (code.startsWith('4') ? 'soft' : 'hard'), smtp_code: code, diagnostic_message: diag.slice(0, 250) };
}

net.createServer((sock) => {
  let verp = '', inData = false, raw = '';
  sock.write('220 b.sendemail.ai ESMTP Bounce Receiver\r\n');
  sock.on('data', async (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (inData) {
        if (line === '.') {
          inData = false;
          const payload = parseBounce(verp, raw);
          if (payload.recipient_email) fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-service': 'sendemail-bounce-parser' }, body: JSON.stringify(payload) }).catch(() => {});
          raw = ''; sock.write('250 2.0.0 OK Bounce ingested\r\n');
        } else { raw += line + '\n'; }
        continue;
      }
      const up = line.toUpperCase();
      if (up.startsWith('EHLO') || up.startsWith('HELO')) sock.write('250 b.sendemail.ai\r\n');
      else if (up.startsWith('MAIL FROM:')) sock.write('250 2.1.0 OK\r\n');
      else if (up.startsWith('RCPT TO:')) { verp = (line.match(/<([^>]+)>/)?.[1] || line.slice(8)).trim(); sock.write('250 2.1.5 OK\r\n'); }
      else if (up === 'DATA') { inData = true; sock.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
      else if (up === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
      else if (line) sock.write('250 OK\r\n');
    }
  });
}).listen(PORT, '0.0.0.0', () => console.log('smtp-bounce-receiver listening on', PORT));

/**
 * A minimal SMTP server on 127.0.0.1 for tests: greets, answers EHLO with AUTH PLAIN (no STARTTLS,
 * so the client stays in the clear), accepts one authentication, and stores every DATA block.
 * Enough to prove that the transport built from an `SmtpConfig` really speaks SMTP end to end.
 */
export interface FakeSmtp {
  readonly port: number;
  /** Decoded `user\0pass` pairs the clients authenticated with. */
  readonly auths: { user: string; pass: string }[];
  /** Raw message sources (headers + body), one per DATA block. */
  readonly messages: string[];
  /** Envelopes as seen on the wire. */
  readonly envelopes: { from: string; to: string[] }[];
  close(): void;
}

interface Conn {
  buf: string;
  inData: boolean;
  data: string[];
  from: string;
  to: string[];
}

export function startFakeSmtp(): FakeSmtp {
  const auths: FakeSmtp['auths'] = [];
  const messages: string[] = [];
  const envelopes: FakeSmtp['envelopes'] = [];
  const server = Bun.listen<Conn>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(s) {
        s.data = { buf: '', inData: false, data: [], from: '', to: [] };
        s.write('220 fake.test ESMTP\r\n');
      },
      data(s, chunk) {
        const c = s.data;
        c.buf += Buffer.from(chunk).toString('utf8');
        let idx = c.buf.indexOf('\r\n');
        while (idx >= 0) {
          const line = c.buf.slice(0, idx);
          c.buf = c.buf.slice(idx + 2);
          idx = c.buf.indexOf('\r\n');
          if (c.inData) {
            if (line === '.') {
              c.inData = false;
              messages.push(c.data.join('\r\n'));
              envelopes.push({ from: c.from, to: c.to });
              c.data = [];
              s.write(`250 OK queued as fake-${messages.length}\r\n`);
            } else c.data.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          const verb = line.split(' ')[0]?.toUpperCase() ?? '';
          switch (verb) {
            case 'EHLO':
            case 'HELO':
              s.write('250-fake.test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
              break;
            case 'AUTH': {
              const b64 = line.split(' ')[2] ?? '';
              const [, user = '', pass = ''] = Buffer.from(b64, 'base64')
                .toString('utf8')
                .split('\0');
              auths.push({ user, pass });
              s.write(
                user
                  ? '235 2.7.0 Authentication successful\r\n'
                  : '535 5.7.8 Authentication failed\r\n',
              );
              break;
            }
            case 'MAIL':
              c.from = line.replace(/^MAIL FROM:\s*/i, '').replace(/^<|>.*$/g, '');
              c.to = [];
              s.write('250 OK\r\n');
              break;
            case 'RCPT':
              c.to.push(line.replace(/^RCPT TO:\s*/i, '').replace(/^<|>.*$/g, ''));
              s.write('250 OK\r\n');
              break;
            case 'DATA':
              c.inData = true;
              s.write('354 End data with <CR><LF>.<CR><LF>\r\n');
              break;
            case 'QUIT':
              s.write('221 Bye\r\n');
              s.end();
              break;
            default:
              s.write('250 OK\r\n');
          }
        }
      },
      error() {},
    },
  });
  return {
    port: server.port ?? 0,
    auths,
    messages,
    envelopes,
    close: () => server.stop(true),
  };
}

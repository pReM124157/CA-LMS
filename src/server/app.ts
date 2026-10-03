import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { RunnerOperationError, type Runner } from '../orchestration/runner.js';
import { testRemoteBrowserConnection } from '../browser/browserManager.js';
const dashboard = `<!doctype html><title>LMS Cloud Runner</title><style>body{font:16px system-ui;max-width:760px;margin:3rem auto;padding:1rem}button{margin:.25rem;padding:.5rem}.card{border:1px solid #ddd;padding:1rem;border-radius:.5rem}</style><h1>LMS CLOUD RUNNER</h1><div class=card id=status>Loading…</div><p><button onclick="post('/api/runner/start')">Start</button><button onclick="post('/api/runner/pause')">Pause</button><button onclick="post('/api/runner/resume')">Resume</button><button onclick="post('/api/runner/stop')">Stop</button></p><script>async function post(u,b){await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});load()}async function load(){let s=await (await fetch('/api/status')).json();status.innerHTML='<b>Status:</b> '+s.state+'<br><b>Browser:</b> '+(s.browser?'CONNECTED':'DISCONNECTED')+(s.pending?'<hr><b>QUESTION DETECTED</b><p>'+s.pending.text+'</p>'+s.pending.options.map(o=>'<button onclick="post(&quot;/api/question/confirm&quot;,{optionId:&quot;'+o.id+'&quot;})">'+o.text+'</button>').join(''):'')}load();setInterval(load,2000)</script>`;
function auth(request: Request, response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  const expected = `Basic ${Buffer.from(`${env.DASHBOARD_USERNAME}:${env.DASHBOARD_PASSWORD}`).toString('base64')}`;
  if (header !== expected) {
    response.setHeader('WWW-Authenticate', 'Basic');
    response.status(401).send('Authentication required');
    return;
  }
  next();
}
export function createApp(
  runner: Runner,
  checkDatabase: () => Promise<boolean> = async () => false,
): express.Express {
  const app = express();
  app.use(helmet());
  app.get('/health', async (_request, response) => {
    const status = runner.status();
    const database = await checkDatabase();
    response.json({
      status: database ? 'ok' : 'degraded',
      database,
      browser: status.browser
        ? 'connected'
        : env.REMOTE_BROWSER_WS_URL
          ? 'disconnected'
          : 'not_configured',
      runnerState: status.state,
      runnerHeartbeatAgeMs: status.heartbeatAt ? Date.now() - status.heartbeatAt : null,
      timestamp: new Date().toISOString(),
    });
  });
  app.use(auth);
  app.use(express.json({ limit: '20kb' }));
  app.get('/', (_request, response) => response.type('html').send(dashboard));
  app.get('/api/status', (_request, response) => response.json(runner.status()));
  app.get('/api/current', (_request, response) => response.json(runner.status()));
  app.get('/api/questions/pending', (_request, response) =>
    response.json(runner.status().pending ? [runner.status().pending] : []),
  );
  app.post('/api/browser/test', async (_request, response) =>
    response
      .status(env.REMOTE_BROWSER_WS_URL ? 200 : 503)
      .json(await testRemoteBrowserConnection()),
  );
  app.post('/api/runner/start', async (_request, response) => {
    await runner.start();
    response.status(202).json(runner.status());
  });
  app.post('/api/runner/pause', async (_request, response) => {
    await runner.pause();
    response.json(runner.status());
  });
  app.post('/api/runner/resume', async (_request, response) => {
    await runner.resume();
    response.json(runner.status());
  });
  app.post('/api/runner/stop', async (_request, response) => {
    await runner.stop();
    response.json(runner.status());
  });
  app.post('/api/icai/otp', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    let otp: unknown = request.body?.otp;
    if (request.body && typeof request.body === 'object') delete request.body.otp;
    if (typeof otp !== 'string' || !/^\d{4,8}$/.test(otp)) {
      response.status(400).json({ ok: false, error: 'ICAI_OTP_FORMAT_INVALID' });
      return;
    }
    try {
      await runner.submitIcaiOtp(otp);
      const status = runner.status();
      response.status(status.state === 'ERROR' ? 409 : 200).json({
        ok: status.state !== 'ERROR',
        ...(status.errorCode ? { error: status.errorCode } : {}),
        status,
      });
    } catch (error) {
      response.status(error instanceof RunnerOperationError ? 409 : 500).json({
        ok: false,
        error: error instanceof RunnerOperationError ? error.code : 'ICAI_LOGIN_NOT_CONFIRMED',
      });
    } finally {
      otp = undefined;
    }
  });
  app.post('/api/question/confirm', async (request, response) => {
    try {
      const optionId = typeof request.body.optionId === 'string' ? request.body.optionId : '';
      await runner.confirm(optionId);
      response.json({ ok: true, status: runner.status() });
    } catch (error) {
      if (error instanceof RunnerOperationError) {
        response
          .status(error.code === 'BROWSER_SESSION_EXPIRED' ? 503 : 409)
          .json({ ok: false, error: error.code, recoverable: error.recoverable });
        return;
      }
      response
        .status(500)
        .json({ ok: false, error: 'ANSWER_CONFIRMATION_FAILED', recoverable: true });
    }
  });
  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    const malformed = _error instanceof SyntaxError;
    response
      .status(malformed ? 400 : 500)
      .json({ ok: false, error: malformed ? 'INVALID_REQUEST' : 'REQUEST_FAILED' });
  });
  return app;
}

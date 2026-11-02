import { ipHash } from '../security.js';

const clients = new Set();
const heartbeat = setInterval(() => {
  for (const client of clients) {
    try {
      client.res.write(': heartbeat\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 25_000);
heartbeat.unref();

export function subscribeSiteUpdates(req, res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  res.write('event: connected\ndata: {"ok":true}\n\n');

  const client = { res, ip: ipHash(req) };
  clients.add(client);

  // 单个 IP 最多保留 5 个实时连接，避免异常页面无限占用连接。
  const sameIp = [...clients].filter((item) => item.ip === client.ip);
  if (sameIp.length > 5) {
    const oldest = sameIp.find((item) => item !== client);
    oldest?.res.end();
    if (oldest) clients.delete(oldest);
  }

  req.on('close', () => {
    clients.delete(client);
  });
}

export function broadcastSiteUpdate(reason = 'content') {
  const payload = JSON.stringify({ reason, at: new Date().toISOString() });
  for (const client of clients) {
    try {
      client.res.write(`event: site-update\ndata: ${payload}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

export function closeSiteUpdateConnections() {
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      // 已断开的连接无需再次处理。
    }
  }
  clients.clear();
}

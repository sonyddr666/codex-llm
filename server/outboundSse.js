export function setupSse(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function writeSse(res, event) {
  const type = event.type || "message";
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

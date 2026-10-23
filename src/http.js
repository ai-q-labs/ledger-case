// Shared HTTP hardening for the game and the clerk pages.

export function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

// Never send stack traces or internal messages to the browser.
export function errorHandler(log = console.error) {
  return (err, _req, res, _next) => {
    log(`[error] ${err?.message ?? err}`);
    if (res.headersSent) return;
    const status = err?.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Try again.' : 'Bad request.' });
  };
}

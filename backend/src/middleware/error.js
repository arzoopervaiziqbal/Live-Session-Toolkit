function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  } else {
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  const body = { success: false, error: err.message || "Internal server error." };
  if (err.errors) body.errors = err.errors;
  res.status(status).json(body);
}

/** Helper for throwing HTTP-shaped errors from controllers. */
function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

module.exports = { notFound, errorHandler, httpError };

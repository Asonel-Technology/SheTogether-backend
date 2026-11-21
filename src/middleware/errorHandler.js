import { ApiError } from '../utils/errors.js';
import { isProd } from '../config/env.js';

export const notFoundHandler = (req, _res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route not found: ${req.method} ${req.path}`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON';
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large';
  } else if (err?.code === 'P2002') {
    status = 409; code = 'ALREADY_EXISTS'; message = `Already exists: ${[].concat(err.meta?.target ?? []).join(', ') || 'unique field'}`;
  } else if (err?.code === 'P2025') {
    status = 404; code = 'NOT_FOUND'; message = 'Resource not found';
  } else if (err?.code === 'P2003') {
    status = 409; code = 'RELATION_CONFLICT'; message = 'Related resource does not exist or is still in use';
  } else if (err?.code === 'P2024' || err?.code === 'P1001' || err?.code === 'P1017') {
    status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'Database temporarily unavailable, please retry';
  } else {
    req.log?.error({ err }, 'unhandled error');
  }

  if (status >= 500 && !isProd && !(err instanceof ApiError)) details = [{ message: String(err?.message) }];
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}

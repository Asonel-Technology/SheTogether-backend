export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m = 'Bad request', d, c = 'BAD_REQUEST') => new ApiError(400, c, m, d);
export const unauthorized = (m = 'Authentication required', c = 'UNAUTHORIZED') => new ApiError(401, c, m);
export const forbidden = (m = 'You do not have permission to do this', c = 'FORBIDDEN') => new ApiError(403, c, m);
export const notFound = (m = 'Resource not found', c = 'NOT_FOUND') => new ApiError(404, c, m);
export const conflict = (m = 'Conflict', c = 'CONFLICT') => new ApiError(409, c, m);
export const unprocessable = (m, c = 'UNPROCESSABLE') => new ApiError(422, c, m);
export const tooMany = (m = 'Too many requests', c = 'RATE_LIMITED') => new ApiError(429, c, m);
export const unavailable = (m = 'Service unavailable', c = 'SERVICE_UNAVAILABLE') => new ApiError(503, c, m);

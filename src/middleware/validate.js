import { ApiError } from '../utils/errors.js';

const issue = (where) => (i) => ({ in: where, path: i.path.join('.'), message: i.message });

export const validate = ({ body, query, params }) => (req, _res, next) => {
  const valid = {};
  const problems = [];
  for (const [where, schema, input] of [
    ['params', params, req.params],
    ['query', query, req.query],
    ['body', body, req.body ?? {}],
  ]) {
    if (!schema) continue;
    const r = schema.safeParse(input);
    if (r.success) valid[where] = r.data;
    else problems.push(...r.error.issues.map(issue(where)));
  }
  if (problems.length) return next(new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', problems));
  req.valid = valid;
  next();
};

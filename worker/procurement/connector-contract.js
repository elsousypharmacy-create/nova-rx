// Supplier connector contract, error classes and registry
// (docs/procurement/ARCHITECTURE.md section 3).
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

export class ConnectorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AuthRequiredError extends ConnectorError {
  constructor(message) {
    super(message, 'AUTH_REQUIRED');
  }
}

export class RateLimitedError extends ConnectorError {
  constructor(message, retryAfterMs) {
    super(message, 'RATE_LIMITED');
    this.retryAfterMs = retryAfterMs;
  }
}

export class SchemaDriftError extends ConnectorError {
  constructor(message, { missing = [], unexpected = [] } = {}) {
    super(message, 'SCHEMA_DRIFT');
    this.missing = missing;
    this.unexpected = unexpected;
  }
}

export class TransientError extends ConnectorError {
  constructor(message) {
    super(message, 'TRANSIENT');
  }
}

export class NotAuthorizedError extends ConnectorError {
  constructor(message) {
    super(message, 'NOT_AUTHORIZED');
  }
}

export const AUTHORIZATION_KINDS = Object.freeze([
  'official-api',
  'written-permission',
  'export-file',
  'fixture',
]);

export function assertConnector(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    throw new TypeError('connector must be a plain object');
  }
  if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) {
    throw new TypeError("connector.id must match /^[a-z0-9-]+$/");
  }
  if (typeof c.displayName !== 'string' || c.displayName === '') {
    throw new TypeError('connector.displayName must be a non-empty string');
  }
  if (!AUTHORIZATION_KINDS.includes(c.authorization)) {
    throw new TypeError(
      `connector.authorization must be one of: ${AUTHORIZATION_KINDS.join(', ')} (got ${JSON.stringify(c.authorization)})`,
    );
  }
  if (!c.capabilities || typeof c.capabilities !== 'object' || Array.isArray(c.capabilities)) {
    throw new TypeError('connector.capabilities must be an object');
  }
  for (const fn of ['search', 'getProduct', 'toOffer']) {
    if (typeof c[fn] !== 'function') {
      throw new TypeError(`connector.${fn} must be a function`);
    }
  }
  if (
    !c.rateLimit ||
    typeof c.rateLimit.requestsPerMinute !== 'number' ||
    !(c.rateLimit.requestsPerMinute > 0)
  ) {
    throw new TypeError('connector.rateLimit.requestsPerMinute must be a positive number');
  }
}

const registry = new Map();

export function registerConnector(connector) {
  assertConnector(connector);
  if (registry.has(connector.id)) {
    throw new TypeError(`connector id "${connector.id}" is already registered`);
  }
  registry.set(connector.id, connector);
  return connector;
}

export function getConnector(id) {
  return registry.get(id) ?? null;
}

export function listConnectors() {
  return [...registry.values()];
}

export function clearRegistry() {
  registry.clear();
}

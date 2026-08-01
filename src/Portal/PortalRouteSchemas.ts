/**
 * Route options for the portal API: the contract schemas bound to the routes
 * that serve them, plus the wording each route reports when validation refuses
 * a request.
 *
 * These live apart from the handlers so the route files stay readable, and
 * apart from Contract/ because `config.invalidMessage` is a Fastify concern
 * that has no place in a payload description a client also compiles.
 */

import { APP_SESSION_LIST, APP_SESSION_PARAMS, GRANTED_TOKENS } from '../Contract/AppAuth.js';
import { ERROR_BODY, INVALID_CONFIG_BODY, OK_BODY } from '../Contract/Common.js';
import { BANK_PARAMS, CONFIG_BODY, VALIDATION_REPORT } from '../Contract/Config.js';
import { DEVICE_BODY } from '../Contract/Devices.js';
import { OTP_SETTINGS, OTP_SUBMIT_BODY, OTP_SUBMIT_PARAMS, PENDING_OTP_BODY } from '../Contract/Otp.js';
import { STATUS_BODY } from '../Contract/Status.js';

/** Every way a config write can end: accepted, refused, or failed to persist. */
const CONFIG_WRITE_RESPONSES = { 200: OK_BODY, 400: INVALID_CONFIG_BODY, 500: ERROR_BODY };

/** Accepted or refused, with no per-check detail behind the refusal. */
const SIMPLE_RESPONSES = { 200: OK_BODY, 400: ERROR_BODY };

/** GET /api/status. */
export const STATUS_ROUTE = { schema: { response: { 200: STATUS_BODY } } };

/** GET /api/config. */
export const CONFIG_READ_ROUTE = { schema: { response: { 200: CONFIG_BODY } } };

/** PUT /api/config. */
export const CONFIG_WRITE_ROUTE = {
  schema: { body: CONFIG_BODY, response: CONFIG_WRITE_RESPONSES },
  config: { invalidMessage: 'Invalid configuration' },
};

/** POST /api/banks/:name. */
export const BANK_ADD_ROUTE = {
  schema: { params: BANK_PARAMS, body: CONFIG_BODY, response: CONFIG_WRITE_RESPONSES },
  config: { invalidMessage: 'Invalid bank configuration' },
};

/** DELETE /api/banks/:name. */
export const BANK_REMOVE_ROUTE = {
  schema: { params: BANK_PARAMS, response: CONFIG_WRITE_RESPONSES },
  config: { invalidMessage: 'Invalid bank configuration' },
};

/** POST and DELETE /api/devices. */
export const DEVICE_ROUTE = {
  schema: { body: DEVICE_BODY, response: SIMPLE_RESPONSES },
  config: { invalidMessage: 'Invalid Expo push token' },
};

/** POST /api/validate. */
export const VALIDATE_ROUTE = {
  schema: { body: CONFIG_BODY, response: { 200: VALIDATION_REPORT, 400: ERROR_BODY } },
  config: { invalidMessage: 'Invalid configuration' },
};

/** GET /api/otp/pending. */
export const OTP_PENDING_SCHEMA = { response: { 200: PENDING_OTP_BODY } };

/** POST /api/otp/:id. */
export const OTP_SUBMIT_SCHEMA = {
  params: OTP_SUBMIT_PARAMS,
  body: OTP_SUBMIT_BODY,
  response: { 200: OK_BODY, 400: ERROR_BODY, 404: ERROR_BODY },
};

/** GET /api/otp/settings. */
export const OTP_SETTINGS_READ_SCHEMA = { response: { 200: OTP_SETTINGS } };

/** PUT /api/otp/settings. */
export const OTP_SETTINGS_WRITE_SCHEMA = { body: OTP_SETTINGS, response: SIMPLE_RESPONSES };

/**
 * POST /auth/app/token and /auth/app/refresh.
 *
 * Response only. These routes answer 503 when app sign-in is switched off, and
 * that answer is decided before the body is read; schema validation runs
 * earlier still, so declaring a request body here would turn a
 * disabled-importer reply from 503 into 400.
 */
export const APP_GRANT_SCHEMA = {
  response: { 200: GRANTED_TOKENS, 400: ERROR_BODY, 503: ERROR_BODY },
};

/** POST /auth/app/revoke, which never reports whether the token was real. */
export const APP_REVOKE_SCHEMA = { response: { 200: OK_BODY } };

/** GET /api/app/sessions. */
export const APP_SESSION_LIST_SCHEMA = { response: { 200: APP_SESSION_LIST } };

/** DELETE /api/app/sessions/:id. */
export const APP_SESSION_REVOKE_SCHEMA = {
  params: APP_SESSION_PARAMS,
  response: { 200: OK_BODY, 404: ERROR_BODY },
};

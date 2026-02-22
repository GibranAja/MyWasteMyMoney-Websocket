'use strict';

const { ValidationError } = require('../utils/errors');

// ---- Primitive validators ----

function isString(v) { return typeof v === 'string'; }
function isNumber(v) { return typeof v === 'number' && !isNaN(v); }
function isInteger(v) { return Number.isInteger(v); }
function isBoolean(v) { return typeof v === 'boolean'; }

// ---- Schema field validators ----

const field = {
  string({ required = true, minLength = 0, maxLength = 500, pattern } = {}) {
    return (key, val, errors) => {
      if (val === undefined || val === null || val === '') {
        if (required) errors[key] = `${key} is required`;
        return;
      }
      if (!isString(val)) { errors[key] = `${key} must be a string`; return; }
      if (val.length < minLength) { errors[key] = `${key} must be at least ${minLength} characters`; return; }
      if (val.length > maxLength) { errors[key] = `${key} must not exceed ${maxLength} characters`; return; }
      if (pattern && !pattern.test(val)) { errors[key] = `${key} format is invalid`; return; }
    };
  },

  email({ required = true } = {}) {
    // RFC-5321 simplified pattern
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (key, val, errors) => {
      if (val === undefined || val === null || val === '') {
        if (required) errors[key] = `${key} is required`;
        return;
      }
      if (!isString(val) || !EMAIL_RE.test(val) || val.length > 254) {
        errors[key] = `${key} must be a valid email address`;
      }
    };
  },

  password({ required = true, minLength = 8 } = {}) {
    return (key, val, errors) => {
      if (val === undefined || val === null || val === '') {
        if (required) errors[key] = `${key} is required`;
        return;
      }
      if (!isString(val)) { errors[key] = `${key} must be a string`; return; }
      if (val.length < minLength) { errors[key] = `${key} must be at least ${minLength} characters`; return; }
      if (val.length > 128)       { errors[key] = `${key} is too long`; return; }
      // Require at least one letter and one digit
      if (!/[A-Za-z]/.test(val) || !/[0-9]/.test(val)) {
        errors[key] = `${key} must contain at least one letter and one number`;
      }
    };
  },

  number({ required = true, min = -Infinity, max = Infinity, integer = false } = {}) {
    return (key, val, errors) => {
      if (val === undefined || val === null) {
        if (required) errors[key] = `${key} is required`;
        return;
      }
      const n = Number(val);
      if (!isNumber(n)) { errors[key] = `${key} must be a number`; return; }
      if (integer && !isInteger(n)) { errors[key] = `${key} must be an integer`; return; }
      if (n < min) { errors[key] = `${key} must be >= ${min}`; return; }
      if (n > max) { errors[key] = `${key} must be <= ${max}`; return; }
    };
  },

  enum(values, { required = true } = {}) {
    return (key, val, errors) => {
      if (val === undefined || val === null) {
        if (required) errors[key] = `${key} is required`;
        return;
      }
      if (!values.includes(val)) {
        errors[key] = `${key} must be one of: ${values.join(', ')}`;
      }
    };
  },

  optional(innerValidator) {
    return (key, val, errors) => {
      if (val === undefined || val === null) return;
      innerValidator(key, val, errors);
    };
  },
};

/**
 * Validate an object against a schema map.
 * schema: { fieldName: validator_fn, ... }
 * Throws ValidationError if any field fails.
 */
function validate(schema, data) {
  const errors = {};
  for (const [key, validator] of Object.entries(schema)) {
    validator(key, data[key], errors);
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', errors);
  }
  // Return only validated keys (strip extra fields)
  const cleaned = {};
  for (const key of Object.keys(schema)) {
    if (data[key] !== undefined && data[key] !== null) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

module.exports = { field, validate };

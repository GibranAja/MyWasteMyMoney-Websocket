'use strict';

class AppError extends Error {
  constructor(message, httpStatus, errorCode, metadata = {}) {
    super(message);
    this.name       = this.constructor.name;
    this.httpStatus = httpStatus;
    this.errorCode  = errorCode;
    this.metadata   = metadata;
  }

  toJSON() {
    return {
      error: {
        code:     this.errorCode,
        message:  this.message,
        metadata: this.metadata,
      },
    };
  }
}

class ValidationError extends AppError {
  constructor(message, fields = {}) {
    super(message, 422, 'VALIDATION_ERROR', { fields });
  }
}

class AuthError extends AppError {
  constructor(message, code = 'AUTH_ERROR') {
    super(message, 401, code);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class InsufficientPointsError extends AppError {
  constructor(required, available) {
    super('Insufficient points balance', 400, 'INSUFFICIENT_POINTS', { required, available });
  }
}

class OutOfStockError extends AppError {
  constructor(rewardName) {
    super(`Reward "${rewardName}" is out of stock`, 400, 'OUT_OF_STOCK');
  }
}

class RateLimitError extends AppError {
  constructor() {
    super('Too many requests. Please slow down.', 429, 'RATE_LIMIT_EXCEEDED');
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InsufficientPointsError,
  OutOfStockError,
  RateLimitError,
};

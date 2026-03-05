'use strict';

const { field, validate } = require('./schema');

const ROLES = ['USER', 'VERIFIER', 'ADMIN', 'MERCHANT'];
const SUBMISSION_STATUSES = ['APPROVED', 'REJECTED'];
const MERCHANT_STATUSES   = ['ACTIVE', 'INACTIVE', 'PENDING'];

const authValidators = {
  register(body) {
    return validate({
      name:     field.string({ minLength: 2, maxLength: 100 }),
      email:    field.email(),
      password: field.password({ minLength: 8 }),
      role:     field.optional(field.enum(ROLES)),
    }, body);
  },

  login(body) {
    return validate({
      email:    field.email(),
      password: field.string({ minLength: 1, maxLength: 128 }),
    }, body);
  },
};

const wasteValidators = {
  create(body) {
    return validate({
      waste_type_id: field.number({ min: 1, integer: true }),
      weight_kg:     field.number({ min: 0.001, max: 100000 }),
      location:      field.string({ minLength: 3, maxLength: 500 }),
      photo_ref:     field.optional(field.string({ maxLength: 500 })),
    }, body);
  },

  verify(body) {
    return validate({
      action: field.enum(SUBMISSION_STATUSES),
      notes:  field.optional(field.string({ maxLength: 1000 })),
    }, body);
  },
};

const rewardValidators = {
  create(body) {
    return validate({
      name:            field.string({ minLength: 2, maxLength: 200 }),
      description:     field.optional(field.string({ maxLength: 1000 })),
      required_points: field.number({ min: 1, integer: true }),
      stock:           field.number({ min: 0, integer: true }),
      merchant_id:     field.optional(field.string({ maxLength: 36 })),
    }, body);
  },

  update(body) {
    return validate({
      name:            field.optional(field.string({ minLength: 2, maxLength: 200 })),
      description:     field.optional(field.string({ maxLength: 1000 })),
      required_points: field.optional(field.number({ min: 1, integer: true })),
      stock:           field.optional(field.number({ min: 0, integer: true })),
      status:          field.optional(field.enum(['ACTIVE', 'INACTIVE'])),
      merchant_id:     field.optional(field.string({ maxLength: 36 })),
    }, body);
  },
};

const merchantValidators = {
  register(body) {
    return validate({
      shop_name:   field.string({ minLength: 2, maxLength: 200 }),
      description: field.optional(field.string({ maxLength: 1000 })),
      address:     field.string({ minLength: 5, maxLength: 500 }),
    }, body);
  },

  update(body) {
    return validate({
      shop_name:   field.optional(field.string({ minLength: 2, maxLength: 200 })),
      description: field.optional(field.string({ maxLength: 1000 })),
      address:     field.optional(field.string({ minLength: 5, maxLength: 500 })),
    }, body);
  },

  setStatus(body) {
    return validate({
      status: field.enum(MERCHANT_STATUSES),
    }, body);
  },
};

module.exports = { authValidators, wasteValidators, rewardValidators, merchantValidators };

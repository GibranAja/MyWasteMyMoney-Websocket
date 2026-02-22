'use strict';

const wasteSvc = require('../services/waste.service');
const { wasteValidators } = require('../validators');
const { sendSuccess } = require('../middlewares');

async function submit(req, res) {
  const data = wasteValidators.create(req.body);
  const submission = await wasteSvc.submit({
    userId:       req.user.user_id,
    wasteTypeId:  data.waste_type_id,
    weightKg:     data.weight_kg,
    location:     data.location,
    photoRef:     data.photo_ref,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 201, { message: 'Submission created', submission });
}

async function verify(req, res) {
  const data = wasteValidators.verify(req.body);
  const result = await wasteSvc.verify({
    submissionId: req.params.id,
    verifierId:   req.user.user_id,
    action:       data.action,
    notes:        data.notes,
  }, { ip: req.socket.remoteAddress });
  sendSuccess(res, 200, { message: 'Submission verified', result });
}

async function listMine(req, res) {
  const page   = Math.max(1, parseInt(req.query?.page) || 1);
  const limit  = Math.min(100, parseInt(req.query?.limit) || 20);
  const status = req.query?.status;
  const submissions = await wasteSvc.listMySubmissions(req.user.user_id, { page, limit, status });
  sendSuccess(res, 200, { submissions });
}

async function listPending(req, res) {
  const page  = Math.max(1, parseInt(req.query?.page) || 1);
  const limit = Math.min(100, parseInt(req.query?.limit) || 20);
  const submissions = await wasteSvc.listPending({ page, limit });
  sendSuccess(res, 200, { submissions });
}

async function getOne(req, res) {
  const submission = await wasteSvc.getSubmission(req.params.id, req.user);
  sendSuccess(res, 200, { submission });
}

module.exports = { submit, verify, listMine, listPending, getOne };

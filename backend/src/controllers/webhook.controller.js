/**
 * webhook.controller.js — GitHub Webhook Request Handler.
 *
 * Endpoint: POST /api/webhooks/github
 *
 * Security:
 *   1. Does NOT use JWT authentication (requests originate from GitHub).
 *   2. Verifies HMAC SHA-256 signature (X-Hub-Signature-256) using GITHUB_WEBHOOK_SECRET.
 *   3. Uses timing-safe string comparison.
 *   4. Rejects invalid signatures with HTTP 401.
 *   5. Processes push events asynchronously, acknowledging immediately with HTTP 202.
 */

const webhookService = require('../services/webhook.service');
const logger         = require('../utils/logger.util');

/**
 * Handle incoming GitHub Webhook HTTP POST request.
 */
const handleGithubWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event     = req.headers['x-github-event'];
    const delivery  = req.headers['x-github-delivery'];

    // 1. Signature Verification using raw request body
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body));
    const isValid = webhookService.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      logger.warn(`[WEBHOOK] Signature verification failed from ${req.ip}`);
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    // 2. Event type check — Phase 5 supports push events
    if (event !== 'push') {
      logger.info(`[WEBHOOK] Ignored non-push event type: ${event}`);
      return res.status(200).json({ success: true, message: `Event '${event}' ignored` });
    }

    // Parse payload
    const payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody.toString('utf-8'));

    // 3. Process push event asynchronously
    const result = await webhookService.processPushWebhook(delivery, payload);

    if (result.status === 'accepted') {
      return res.status(202).json({
        success: true,
        message: result.message,
        deploymentId: result.deploymentId,
      });
    }

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    logger.error(`[WEBHOOK] Internal webhook processing error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal webhook processing error' });
  }
};

module.exports = {
  handleGithubWebhook,
};

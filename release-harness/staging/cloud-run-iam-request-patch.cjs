'use strict';

const playwright = require('@playwright/test');

const token = String(process.env.CLOUD_RUN_ID_TOKEN || '').trim();
if (!token) {
  throw new Error('CLOUD_RUN_ID_TOKEN is required for Cloud Run IAM request patching');
}

const originalNewContext = playwright.request.newContext.bind(playwright.request);

playwright.request.newContext = async function cloudRunAwareNewContext(options = {}) {
  return originalNewContext({
    ...options,
    extraHTTPHeaders: {
      ...(options.extraHTTPHeaders || {}),
      'X-Serverless-Authorization': `Bearer ${token}`,
    },
  });
};

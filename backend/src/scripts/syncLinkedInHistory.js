require('dotenv').config();

const mongoose = require('mongoose');

const connectToDatabase = require('../config/db');
const { upsertLinkedInHistory } = require('../services/linkedinSync');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Set ${name} in backend .env before running LinkedIn sync.`);
  }
  return value;
}

async function run() {
  const organizationUrn = requiredEnv('LINKEDIN_ORGANIZATION_URN');
  const accountName = String(process.env.LINKEDIN_ACCOUNT_NAME || 'MigaLabs').trim();
  const accountHandle = String(process.env.LINKEDIN_ACCOUNT_HANDLE || organizationUrn).trim();
  const trackingWindowDays = Number(process.env.LINKEDIN_TRACKING_WINDOW_DAYS || 120);
  const count = Number(process.env.LINKEDIN_SYNC_COUNT || 50);

  await connectToDatabase();

  const summary = await upsertLinkedInHistory({
    organizationUrn,
    accountName,
    accountHandle,
    trackingWindowDays,
    count,
  });

  console.log('LinkedIn sync complete');
  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error('LinkedIn sync failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
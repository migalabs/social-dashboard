const mongoose = require('mongoose');

async function connectToDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error('Missing MONGODB_URI in GitHub Actions environment');
    }

    await mongoose.connect('mongodb://127.0.0.1:27017/ml_social');
    console.log('Connected to local MongoDB');
    return;
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
}

module.exports = connectToDatabase;
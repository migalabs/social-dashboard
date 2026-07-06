const mongoose = require('mongoose');

const linkedInOAuthTokenSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      default: 'linkedin',
      unique: true,
      index: true,
    },
    encryptedAccessToken: {
      type: String,
      required: true,
    },
    encryptedRefreshToken: {
      type: String,
      default: null,
    },
    tokenType: {
      type: String,
      default: 'Bearer',
    },
    scope: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastRefreshedAt: {
      type: Date,
      default: null,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('LinkedInOAuthToken', linkedInOAuthTokenSchema);
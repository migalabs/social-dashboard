const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['linkedin', 'x'],
      required: true,
    },
    externalPostId: {
      type: String,
      required: true,
      unique: true,
    },
    accountName: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: ['seed', 'twitterapi', 'linkedinapi'],
      required: true,
      default: 'seed',
      index: true,
    },
    accountHandle: {
      type: String,
      default: '',
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    isReply: {
      type: Boolean,
      required: true,
      default: false,
    },
    publishedAt: {
      type: Date,
      required: true,
    },
    trackingEnabled: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    trackingDisabledAt: {
      type: Date,
      default: null,
    },
    lastSeenInSourceAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

postSchema.index({ platform: 1, source: 1, accountHandle: 1, publishedAt: -1 });

module.exports = mongoose.model('Post', postSchema);
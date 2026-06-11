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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Post', postSchema);
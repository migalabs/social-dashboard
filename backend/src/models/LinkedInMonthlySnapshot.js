const mongoose = require('mongoose');

const linkedInMonthlySnapshotSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    likesCount: {
      type: Number,
      required: true,
      default: 0,
    },
    commentsCount: {
      type: Number,
      required: true,
      default: 0,
    },
    impressionsCount: {
      type: Number,
      required: true,
      default: 0,
    },
    savesOrBookmarksCount: {
      type: Number,
      required: true,
      default: 0,
    },
    sharesCount: {
      type: Number,
      required: true,
      default: 0,
    },
    totalEngagements: {
      type: Number,
      required: true,
      default: 0,
    },
    engagementRate: {
      type: Number,
      required: true,
      default: 0,
    },
    // How many raw daily snapshots contributed to this rollup
    snapshotCount: {
      type: Number,
      required: true,
      default: 0,
    },
    // Set true once the corresponding raw snapshots have been purged
    rawPurged: {
      type: Boolean,
      required: true,
      default: false,
    },
    rawPurgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

linkedInMonthlySnapshotSchema.index({ post: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('LinkedInMonthlySnapshot', linkedInMonthlySnapshotSchema);

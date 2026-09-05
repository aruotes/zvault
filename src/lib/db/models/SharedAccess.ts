import 'server-only';
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISharedAccess extends Document {
  fileId: string;
  recipientAddress: string;
  txHash: string;
  blockNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

const SharedAccessSchema = new Schema<ISharedAccess>(
  {
    fileId: {
      type: String,
      required: [true, 'fileId is required'],
      index: true,
      trim: true,
    },
    recipientAddress: {
      type: String,
      required: [true, 'recipientAddress is required'],
      index: true,
      trim: true,
      lowercase: true,
    },
    txHash: {
      type: String,
      required: [true, 'txHash is required'],
      unique: true,
      trim: true,
    },
    blockNumber: {
      type: Number,
      required: [true, 'blockNumber is required'],
    },
  },
  {
    timestamps: true,
    collection: 'shared_access',
  },
);

const SharedAccessModel: Model<ISharedAccess> =
  (mongoose.models.SharedAccess as Model<ISharedAccess>) ||
  mongoose.model<ISharedAccess>('SharedAccess', SharedAccessSchema);

export default SharedAccessModel;

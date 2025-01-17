import mongoose from 'mongoose';
import type { Room, YouTubeVideo } from '@/types';

/**
 * These schemas currently not strict and may be not fully correct.
 * They are just for the purpose of demonstration.
 */

// Define a reusable sub-schema for video objects
const videoSchema = new mongoose.Schema<YouTubeVideo>({
    id: { type: String, required: true },
    url: { type: String, required: true },
    title: { type: String, required: true },
    duration: { type: Number, required: true },
    duration_formatted: { type: String },
    uploadedAt: { type: String },
    thumbnail: {
        url: { type: String, required: true },
    },
    channel: {
        name: { type: String, required: true },
        verified: { type: Boolean, required: true },
    },
    views: { type: Number },
    type: { type: String },
});

// Define the room schema
const roomSchema = new mongoose.Schema<Room>({
    id: { type: String, required: true },
    password: { type: String, required: false, default: null },
    clients: [{ type: String }],
    videoQueue: [videoSchema],
    historyQueue: [videoSchema],
    volume: { type: Number, default: 50 },
    playingNow: { type: videoSchema, default: null },
    lastActivity: { type: Number, required: true },
    creatorId: { type: String, required: true },
    isPlaying: { type: Boolean, default: false },
    currentTime: { type: Number, default: 0 },
});

export const RoomModel = mongoose.model<Room>('Room', roomSchema);

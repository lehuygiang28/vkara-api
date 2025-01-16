import mongoose from 'mongoose';
import type { Room } from '@/types';

/**
 * These schemas currently not strict and may be not fully correct.
 * They are just for the purpose of demonstration.
 */

// Define a reusable sub-schema for video objects
const videoSchema = new mongoose.Schema({
    id: { type: String, required: true },
    url: { type: String, required: true },
    shorts_url: { type: String },
    title: { type: String, required: true },
    description: { type: String },
    duration: { type: Number, required: true },
    duration_formatted: { type: String },
    uploadedAt: { type: String },
    unlisted: { type: Boolean, default: false },
    nsfw: { type: Boolean, default: false },
    thumbnail: {
        id: { type: String, required: true },
        width: { type: Number, required: true },
        height: { type: Number, required: true },
        url: { type: String, required: true },
    },
    channel: {
        name: { type: String, required: true },
        id: { type: String, required: true },
        icon: { type: String },
    },
    views: { type: Number },
    type: { type: String },
    tags: [{ type: String }],
    ratings: {
        likes: { type: Number, default: 0 },
        dislikes: { type: Number, default: 0 },
    },
    shorts: { type: Boolean, default: false },
    live: { type: Boolean, default: false },
    private: { type: Boolean, default: false },
    music: [
        {
            artist: { type: String },
            title: { type: String },
        },
    ],
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

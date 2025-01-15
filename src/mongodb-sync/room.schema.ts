import mongoose from 'mongoose';
import type { Room } from '@/types';

const roomSchema = new mongoose.Schema<Room>({
    id: String,
    password: String,
    clients: [String],
    videoQueue: [
        {
            id: String,
            title: String,
            thumbnail: String,
            duration: Number,
        },
    ],
    historyQueue: [
        {
            id: String,
            title: String,
            thumbnail: String,
            duration: Number,
        },
    ],
    volume: Number,
    playingNow: {
        id: String,
        title: String,
        thumbnail: String,
        duration: Number,
    },
    lastActivity: Number,
    creatorId: String,
    isPlaying: Boolean,
    currentTime: Number,
});

export const RoomModel = mongoose.model<Room>('Room', roomSchema);

import mongoose from 'mongoose';
import type { ClientInfo } from '@/types';

const clientSchema = new mongoose.Schema<ClientInfo>({
    id: String,
    roomId: String,
});

export const ClientModel = mongoose.model<ClientInfo>('Client', clientSchema);

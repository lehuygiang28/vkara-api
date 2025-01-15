import { Redis } from 'ioredis';

import { sendToClient, wsConnections } from '@/server';
import { redisLogger, roomLogger } from '@/utils/logger';

const subscriber = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
});

subscriber.subscribe('room-notifications', (err) => {
    if (err) {
        redisLogger.error('Failed to subscribe to room notifications', { error: err });
        return;
    }
    redisLogger.info('Subscribed to room notifications');
});

subscriber.on('message', (channel, message) => {
    if (channel === 'room-notifications') {
        try {
            const notification = JSON.parse(message);
            if (notification.type === 'room-closed') {
                const { clientIds, reason, roomId } = notification;
                roomLogger.info(`Processing room closure notification`, { roomId, reason });

                // Notify clients about room closure
                for (const clientId of clientIds) {
                    const ws = wsConnections.get(clientId);
                    if (ws) {
                        sendToClient(ws, {
                            type: 'roomClosed',
                            reason,
                        });
                    }
                }
            }
        } catch (error) {
            redisLogger.error('Error processing room notification', { error });
        }
    }
});

export default subscriber;

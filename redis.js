import { createClient } from 'redis';

let redisClient;

if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });
} else {
  redisClient = createClient();
}

redisClient.on('error', (err) => console.log('Redis Client Error', err));

await redisClient.connect();

export default redisClient;

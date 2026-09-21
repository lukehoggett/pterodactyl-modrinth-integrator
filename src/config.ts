import dotenv from 'dotenv';
dotenv.config();

export const config = {
    pteroUrl: process.env.PTERO_URL || '',
    pteroKey: process.env.PTERO_CLIENT_KEY || '',
    modrinthUserAgent: process.env.MODRINTH_USER_AGENT || 'MyCustomIntegrator/1.0.0',
    modrinthBaseUrl: process.env.MODRINTH_BASE_URL || 'https://api.modrinth.com/v2',
    modrinthChannel: (process.env.MODRINTH_CHANNEL || 'release').toLowerCase()
};

if (!config.pteroUrl || !config.pteroKey) {
    throw new Error('Missing required Pterodactyl environment variables in .env');
}

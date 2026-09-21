import axios from 'axios';
import { config } from '../config.js';

export class ModrinthService {
    private api = axios.create({
        baseURL: 'https://api.modrinth.com/v2',
        headers: {
            'User-Agent': config.modrinthUserAgent,
            'Content-Type': 'application/json'
        }
    });

    async getVersionsFromHashes(hashes: string[]) {
        // Prevent sending an empty array, which often causes a 400 Bad Request on APIs
        if (hashes.length === 0) {
            console.log("\n[Debug] No hashes provided to Modrinth. Skipping request.");
            return {};
        }

        const payload = {
            hashes: hashes,
            algorithm: 'sha1'
        };

        try {
            const response = await this.api.post('/version_files', payload);
            return response.data; 
        } catch (error: any) {
            console.error("\n--- MODRINTH API ERROR (getVersionsFromHashes) ---");
            console.error("Endpoint: POST /v2/version_files");
            console.error("Payload sent:", JSON.stringify(payload, null, 2));
            
            if (error.response) {
                console.error("Status Code:", error.response.status);
                console.error("Response Data:", JSON.stringify(error.response.data, null, 2));
            } else {
                console.error("Error Message:", error.message);
            }
            console.error("----------------------------------------------------\n");
            throw error;
        }
    }

    async getProjects(projectIds: string[]) {
        if (projectIds.length === 0) return [];

        const params = {
            ids: JSON.stringify(projectIds)
        };

        try {
            const response = await this.api.get('/projects', { params });
            return response.data;
        } catch (error: any) {
            console.error("\n--- MODRINTH API ERROR (getProjects) ---");
            console.error("Endpoint: GET /v2/projects");
            console.error("Params sent:", JSON.stringify(params, null, 2));
            
            if (error.response) {
                console.error("Status Code:", error.response.status);
                console.error("Response Data:", JSON.stringify(error.response.data, null, 2));
            } else {
                console.error("Error Message:", error.message);
            }
            console.error("----------------------------------------------------\n");
            throw error;
        }
    }

    async getLatestVersion(projectId: string, gameVersions: string[], loaders: string[], allowedVersionTypes: string[], debug: boolean = false) {
        // Prepare the exact parameters Modrinth accepts
        const params = {
            game_versions: JSON.stringify(gameVersions),
            loaders: JSON.stringify(loaders)
            // Note: version_type is removed from here because the Modrinth API rejects it!
        };

        if (debug) {
            console.log(`\n[Debug] GET /project/${projectId}/version`);
            console.log(`[Debug] Params sent:`, JSON.stringify(params, null, 2));
        }

        try {
            const response = await this.api.get(`/project/${projectId}/version`, { params });
            const versions = response.data;
            
            if (debug && versions.length > 0) {
                console.log(`[Debug] Modrinth returned ${versions.length} matching versions. Filtering for channels: [${allowedVersionTypes.join(', ')}]`);
            }

            // Perform the version_type filtering locally
            const validVersions = versions.filter((v: any) => allowedVersionTypes.includes(v.version_type));
            
            // Return the first valid version (the API returns them sorted newest to oldest)
            return validVersions[0]; 

        } catch (error: any) {
            console.error(`\n--- MODRINTH API ERROR (getLatestVersion) ---`);
            console.error(`Endpoint: GET /v2/project/${projectId}/version`);
            console.error(`Params sent:`, JSON.stringify(params, null, 2));
            
            if (error.response) {
                console.error("Status Code:", error.response.status);
                console.error("Response Data:", JSON.stringify(error.response.data, null, 2));
            } else {
                console.error("Error Message:", error.message);
            }
            console.error("---------------------------------------------\n");
            throw error;
        }
    }

    async getCompatibleVersions(projectId: string, gameVersions: string[], loaders: string[], allowedVersionTypes: string[], debug: boolean = false) {
        const params = {
            game_versions: JSON.stringify(gameVersions),
            loaders: JSON.stringify(loaders)
        };

        try {
            const response = await this.api.get(`/project/${projectId}/version`, { params });
            const versions = response.data;
            
            // Return all matching versions for the core logic to evaluate
            return versions.filter((v: any) => allowedVersionTypes.includes(v.version_type));
        } catch (error: any) {
            // ... (keep existing error handling)
            throw error;
        }
    }

    // FUTURE: For querying the broader Modrinth catalog
    async searchProjects(query: string, facets: string[] = []) {
        const response = await this.api.get('/search', {
            params: {
                query: query,
                facets: JSON.stringify(facets)
            }
        });
        return response.data;
    }
}
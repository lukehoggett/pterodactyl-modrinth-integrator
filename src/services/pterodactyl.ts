import axios from 'axios';
import { config } from '../config.js';

export class PterodactylService {
    private api = axios.create({
        baseURL: `${config.pteroUrl}/api/client`,
        headers: {
            Authorization: `Bearer ${config.pteroKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    });

    async getServerEnvironment(serverId: string) {
        const response = await this.api.get('/servers/' + serverId);
        let variables = [];
        try {
            const varsResponse = await this.api.get('/servers/' + serverId + '/variables');
            variables = varsResponse.data.data;
        } catch (error) {
            try {
                const startupResponse = await this.api.get('/servers/' + serverId + '/startup');
                variables = startupResponse.data.data;
            } catch (innerError) {}
        }
        return {
            name: response.data.attributes.name,
            node: response.data.attributes.node,
            invocation: response.data.attributes.invocation,
            variables: variables
        };
    }

    async getFiles(serverId: string, directory: string = '/mods') {
        const response = await this.api.get(`/servers/${serverId}/files/list`, {
            params: { directory }
        });
        return response.data.data;
    }

    // Requests a temporary signed upload URL from Pterodactyl
    async getUploadUrl(serverId: string) {
        const response = await this.api.get(`/servers/${serverId}/files/upload`);
        return response.data.attributes.url;
    }

    // Renames or moves a file within the server container
    async renameFile(serverId: string, oldFileName: string, newFileName: string) {
        await this.api.put(`/servers/${serverId}/files/rename`, {
            root: '/mods',
            files: [
                {
                    from: oldFileName,
                    to: newFileName
                }
            ]
        });
    }

    // Deletes an old file from the server
    async deleteFile(serverId: string, filePath: string) {
        await this.api.post(`/servers/${serverId}/files/delete`, {
            root: '/mods',
            files: [filePath.replace('/mods/', '')]
        });
    }

    // Uploads a file buffer to the signed Pterodactyl URL
    async uploadFile(uploadUrl: string, fileName: string, fileBuffer: Buffer) {
        const formData = new FormData();

        // Convert the Node Buffer into a standard Uint8Array / ArrayBuffer to satisfy BlobPart typing
        const uint8Array = new Uint8Array(fileBuffer);
        const blob = new Blob([uint8Array]);

        formData.append('files', blob, fileName);

        await axios.post(uploadUrl, formData, {
            // Axios automatically manages the multipart/form-data boundary headers when given FormData
        });
    }

    // Requests the signed download URL for a specific file
    async getDownloadUrl(serverId: string, filePath: string) {
        const response = await this.api.get(`/servers/${serverId}/files/download`, {
            params: { file: filePath }
        });
        return response.data.attributes.url;
    }

    // Downloads the file directly into memory as a Buffer for hashing
    async downloadFileBuffer(downloadUrl: string) {
        const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    }
}

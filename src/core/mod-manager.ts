import crypto from 'crypto';
import { select, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import axios from 'axios';
import { PterodactylService } from '../services/pterodactyl.js';
import { ModrinthService } from '../services/modrinth.js';
import { config } from '../config.js';

export class ModManager {
    private ptero = new PterodactylService();
    private modrinth = new ModrinthService();

    async updateExistingMods(
        serverId: string,
        options: { debug?: boolean; minecraft?: string; loader?: string; channel?: string } = {}
    ) {
        console.log(`\n[Update] Starting process for server: ${serverId}`);

        const env = await this.ptero.getServerEnvironment(serverId);

        let mcVersion = options.minecraft || 'Unknown';
        let loaderVersion = options.loader || 'Unknown';

        if (env.variables && env.variables.length > 0) {
            const mcVar = env.variables.find((v) => v.attributes.env_variable === 'MINECRAFT_VERSION');
            if (mcVar && !options.minecraft) mcVersion = mcVar.attributes.server_value;

            const loaderVar = env.variables.find(
                (v) =>
                    v.attributes.env_variable.includes('LOADER') || v.attributes.env_variable.includes('FABRIC_VERSION')
            );
            if (loaderVar && !options.loader) loaderVersion = loaderVar.attributes.server_value;
        }

        console.log('\n--- Server Environment Data ---');
        console.log('Invocation: ' + env.invocation);
        console.log('Minecraft Version: ' + mcVersion);
        console.log('Mod Loader: ' + loaderVersion);
        console.log('-------------------------------\n');

        if (options.debug) {
            console.log('\n--- DEBUG: PTERODACTYL ENVIRONMENT ---');
            console.log(JSON.stringify(env, null, 2));
            console.log('--------------------------------------\n');
        }

        const files = await this.ptero.getFiles(serverId, '/mods');
        const jarFiles = files.filter((f: any) => f.attributes.name.endsWith('.jar'));
        console.log(`[Update] Found ${jarFiles.length} .jar files. Hashing...\n`);

        const modData: any[] = [];
        const hashes: string[] = [];

        for (const file of jarFiles) {
            const fileName = file.attributes.name;
            process.stdout.write(`Hashing ${fileName}... `);

            const downloadUrl = await this.ptero.getDownloadUrl(serverId, `/mods/${fileName}`);
            const buffer = await this.ptero.downloadFileBuffer(downloadUrl);

            const hash = crypto.createHash('sha1').update(buffer).digest('hex');
            hashes.push(hash);

            modData.push({
                fileName,
                hash,
                currentVersion: 'Unknown',
                latestVersion: 'Unknown',
                updateAvailable: false
            });

            console.log(`[${chalk.cyan(hash)}] Done.`);
        }

        console.log(`\n[Update] Querying Modrinth for version information...`);
        const identifiedMods = await this.modrinth.getVersionsFromHashes(hashes);

        const updatableMods = [];

        const channel = (options.channel || config.modrinthChannel || 'release').toLowerCase();
        let allowedVersionTypes = ['release'];
        if (channel === 'beta') allowedVersionTypes = ['release', 'beta'];
        if (channel === 'alpha') allowedVersionTypes = ['release', 'beta', 'alpha'];

        for (const mod of modData) {
            const match = identifiedMods[mod.hash];
            if (!match) continue;

            mod.projectId = match.project_id;
            mod.currentVersion = match.version_number;

            const currentId = match.id;
            const currentPublishedDate = new Date(match.date_published);

            if (options.debug) {
                console.log(
                    `[Debug] ${mod.fileName} mapped to ${match.project_id}. Game versions: [${match.game_versions}], Loaders: [${match.loaders}]`
                );
            }

            let modSpecificAllowedTypes = [...allowedVersionTypes];
            if (match.version_type === 'beta' && !modSpecificAllowedTypes.includes('beta'))
                modSpecificAllowedTypes.push('beta');
            if (match.version_type === 'alpha' && !modSpecificAllowedTypes.includes('alpha'))
                modSpecificAllowedTypes.push('beta', 'alpha');

            const queryGameVersions = options.minecraft ? [options.minecraft] : match.game_versions;
            const queryLoaders = options.loader ? [options.loader] : match.loaders;

            const compatibleVersions = await this.modrinth.getCompatibleVersions(
                mod.projectId,
                queryGameVersions,
                queryLoaders,
                modSpecificAllowedTypes,
                options.debug
            );

            if (compatibleVersions.length > 0) {
                const latest = compatibleVersions[0];
                mod.latestVersion = latest.version_number;

                const latestId = latest.id;
                const latestPublishedDate = new Date(latest.date_published);

                const isMigration = options.minecraft || options.loader;
                if (currentId !== latestId && (isMigration || latestPublishedDate > currentPublishedDate)) {
                    mod.updateAvailable = true;
                    mod.latestVersionId = latestId;
                    mod.downloadUrl = latest.files.find((f: any) => f.primary)?.url || latest.files[0].url;

                    updatableMods.push({
                        name: mod.fileName,
                        value: mod,
                        description: `Update from ${mod.currentVersion} -> ${mod.latestVersion}\nLink: https://modrinth.com/mod/${mod.projectId}/version/${latestId}`
                    });
                }
            }
        }

        // Build the colorized table
        const table = new Table({
            head: ['File', 'Current', 'Latest', 'Status'].map((h) => chalk.bold(h))
        });

        for (const m of modData) {
            let status = '';
            let rowColor = chalk.white;
            let displayLatest = m.latestVersion;

            if (m.currentVersion === 'Unknown') {
                status = 'Not on Modrinth';
                rowColor = chalk.gray;
                displayLatest = 'Unknown';
            } else if (m.latestVersion === 'Unknown') {
                status = 'No updates found';
                rowColor = chalk.gray;
                displayLatest = 'Unknown';
            } else if (m.updateAvailable) {
                status = 'Update Available';
                rowColor = chalk.hex('#FFA500'); // Amber/Orange
                if (m.projectId && m.latestVersionId) {
                    const modUrl = `https://modrinth.com/mod/${m.projectId}/version/${m.latestVersionId}`;
                    displayLatest = `\x1B]8;;${modUrl}\x07${m.latestVersion}\x1B]8;;\x07`;
                }
            } else {
                status = 'Up to date';
                rowColor = chalk.green;
                displayLatest = m.currentVersion;
            }

            table.push([rowColor(m.fileName), rowColor(m.currentVersion), rowColor(displayLatest), rowColor(status)]);
        }

        console.log(`\n${table.toString()}`);

        if (options.debug && updatableMods.length > 0) {
            console.log(chalk.yellow('\n[Debug] The following mods passed the strict ID and Date check:'));
            updatableMods.forEach((u) => console.log(chalk.gray(` - ${u.name}: ID changed and date is newer.`)));
        }

        if (updatableMods.length === 0) {
            console.log('\nAll mods are up to date! Exiting.');
            return;
        }

        const action = await select({
            message: 'What would you like to do?',
            choices: [
                { name: `Update All (${updatableMods.length} mods)`, value: 'all' },
                { name: 'Select specific mods to update', value: 'select' },
                { name: 'Exit without making changes', value: 'exit' }
            ]
        });

        if (action === 'exit') {
            console.log('Exiting...');
            return;
        }

        let modsToProcess = updatableMods.map((u) => u.value);

        if (action === 'select') {
            modsToProcess = await checkbox({
                message: 'Select the mods you want to update (Space to select, Enter to confirm):',
                choices: updatableMods
            });
        }

        if (modsToProcess.length === 0) {
            console.log('No mods selected. Exiting...');
            return;
        }

        console.log(`\n[Update] Beginning file updates for ${modsToProcess.length} mods...`);

        for (const mod of modsToProcess) {
            try {
                console.log(`\n[Update] Processing: ${mod.fileName} -> Latest (${mod.latestVersion})`);

                // 1. Download the new .jar from Modrinth into memory
                console.log(`  Downloading new version from Modrinth...`);
                const modrinthResponse = await axios.get(mod.downloadUrl, { responseType: 'arraybuffer' });
                const newFileBuffer = Buffer.from(modrinthResponse.data);

                // Derive the clean filename from the download URL (or fallback to original name)
                const newFileName = mod.downloadUrl.split('/').pop() || mod.fileName;
                const disabledName = `${mod.fileName}.disabled`;

                // 2. Rename the old file to append .disabled instead of deleting
                console.log(`  Disabling old version (${mod.fileName} -> ${disabledName})...`);
                await this.ptero.renameFile(serverId, mod.fileName, disabledName);

                // 3. Get a fresh upload URL from Pterodactyl
                const uploadUrl = await this.ptero.getUploadUrl(serverId);

                // 4. Upload the new file buffer to Pterodactyl
                console.log(`  Uploading new file (${newFileName})...`);
                await this.ptero.uploadFile(uploadUrl, newFileName, newFileBuffer);

                console.log(chalk.green(`  Successfully updated ${mod.fileName} (old version archived as .disabled)!`));
            } catch (error: any) {
                console.error(chalk.red(`  Failed to update ${mod.fileName}:`), error.message);
            }
        }

        console.log(chalk.green('\n[Update] All selected updates completed!'));
    }

    async searchNewMods(query: string) {
        console.log(`[Search] Querying Modrinth for: ${query}`);
    }
}

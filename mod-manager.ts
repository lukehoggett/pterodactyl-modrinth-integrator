import crypto from 'crypto';
import { select, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PterodactylService } from './src/services/pterodactyl.js';
import { ModrinthService } from './src/services/modrinth.js';
import { config } from './src/config.js';

export class ModManager {
    private ptero = new PterodactylService();
    private modrinth = new ModrinthService();

    async updateExistingMods(serverId: string, options: { debug?: boolean } = {}) {
        console.log(`\n[Update] Starting process for server: ${serverId}`);

        const env = await this.ptero.getServerEnvironment(serverId);

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
                updateAvailable: false,
                side: 'Unknown'
            });

            console.log(`[${chalk.cyan(hash)}] Done.`);
        }

        console.log(`\n[Update] Querying Modrinth for version information...`);
        const identifiedMods = await this.modrinth.getVersionsFromHashes(hashes);

        // Fetch project details to determine client/server side support
        const projectIds = [...new Set(Object.values(identifiedMods).map((m: any) => m.project_id))].filter(Boolean) as string[];
        const projects = await this.modrinth.getProjects(projectIds);
        const projectMap = projects.reduce((acc: any, p: any) => {
            acc[p.id] = p;
            return acc;
        }, {});

        const updatableMods = [];

        let allowedVersionTypes = ['release'];
        if (config.modrinthChannel === 'beta') allowedVersionTypes = ['release', 'beta'];
        if (config.modrinthChannel === 'alpha') allowedVersionTypes = ['release', 'beta', 'alpha'];

        for (const mod of modData) {
            const match = identifiedMods[mod.hash];
            if (!match) continue;

            mod.projectId = match.project_id;
            mod.currentVersion = match.version_number;

            const project = projectMap[mod.projectId];
            if (project) {
                const cSupported = project.client_side && project.client_side !== 'unsupported';
                const sSupported = project.server_side && project.server_side !== 'unsupported';
                if (cSupported && sSupported) mod.side = 'SC';
                else if (sSupported) mod.side = 'S';
                else if (cSupported) mod.side = 'C';
                else mod.side = '-';
            } else {
                mod.side = '?';
            }

            // Store the exact Modrinth ID and Date for the file we currently have installed
            const currentId = match.id;
            const currentPublishedDate = new Date(match.date_published);

            let modSpecificAllowedTypes = [...allowedVersionTypes];
            if (match.version_type === 'beta' && !modSpecificAllowedTypes.includes('beta')) modSpecificAllowedTypes.push('beta');
            if (match.version_type === 'alpha' && !modSpecificAllowedTypes.includes('alpha')) modSpecificAllowedTypes.push('beta', 'alpha');

            const compatibleVersions = await this.modrinth.getCompatibleVersions(
                mod.projectId,
                match.game_versions,
                match.loaders,
                modSpecificAllowedTypes,
                options.debug
            );

            if (compatibleVersions.length > 0) {
                const latest = compatibleVersions[0];
                mod.latestVersion = latest.version_number;

                const latestId = latest.id;
                const latestPublishedDate = new Date(latest.date_published);

                // The Bulletproof Check: IDs must differ AND the new file must be chronologically newer
                if (currentId !== latestId && latestPublishedDate > currentPublishedDate) {
                    mod.updateAvailable = true;
                    // Save the download URL for the next phase
                    mod.downloadUrl = latest.files.find((f: any) => f.primary)?.url || latest.files[0].url;

                    updatableMods.push({
                        name: mod.fileName,
                        value: mod,
                        description: `Update from ${mod.currentVersion} -> ${mod.latestVersion}`
                    });
                }
            }
        }

        // Build the colorized table (No more visual hacks, strictly relying on the data state)
        const table = new Table({
            head: ['File', 'Current', 'Latest', 'Side', 'Status'].map(h => chalk.bold(h))
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
                rowColor = chalk.hex('#FFA500');
            } else {
                status = 'Up to date';
                rowColor = chalk.green;
                // If it's a backport we rejected, force the visual to show they are identical
                displayLatest = m.currentVersion;
            }

            table.push([
                rowColor(m.fileName),
                rowColor(m.currentVersion),
                rowColor(displayLatest),
                rowColor(m.side),
                rowColor(status)
            ]);
        }

        console.log(`\n${table.toString()}`);

        if (options.debug && updatableMods.length > 0) {
            console.log(chalk.yellow('\n[Debug] The following mods passed the strict ID and Date check:'));
            updatableMods.forEach(u => console.log(chalk.gray(` - ${u.name}: ID changed and date is newer.`)));
        }

        if (updatableMods.length === 0) {
            console.log("\nAll mods are up to date! Exiting.");
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

        let modsToProcess = updatableMods.map(u => u.value);

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

        console.log(`\nProceeding to update ${modsToProcess.length} mods...`);
    }
}

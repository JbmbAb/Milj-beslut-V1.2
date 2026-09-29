import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Recursively find all .ts and .tsx files in a directory
 */
function walkSync(dir: string, filelist: string[] = []): string[] {
    if (!fs.existsSync(dir)) return filelist;

    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            if (file === 'node_modules' || file === 'dist') continue;
            filelist = walkSync(filepath, filelist);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            filelist.push(filepath);
        }
    }
    return filelist;
}

describe('LU Architecture Charter v1.0 - Constitutional Boundary Tests', () => {

    // __dirname is packages/mps-lu/tests
    const packagesDir = path.resolve(__dirname, '../../');
    const rootDir = path.resolve(packagesDir, '../');

    it('Regel 1: Frozen Core får inte importera LU', () => {
        const frozenCorePackages = [
            'mps-compliance',
            'mps-artifact-store',
            'mps-governance'
        ];

        const failedFiles: string[] = [];

        for (const pkg of frozenCorePackages) {
            const pkgDir = path.join(packagesDir, pkg, 'src');
            const files = walkSync(pkgDir);

            for (const file of files) {
                const content = fs.readFileSync(file, 'utf-8');
                if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(content)) {
                    failedFiles.push(file);
                }
            }
        }

        expect(failedFiles, 'Frozen core MUST NOT import mps-lu. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });

    it('Regel 2: LU får inte importera UI, PostGIS eller dokumentprovider', () => {
        const luDir = path.join(packagesDir, 'mps-lu', 'src');
        const files = walkSync(luDir);

        const failedFiles: string[] = [];
        const forbidden = [
            'ui-lu-workspace', 
            'spatial-provider-postgis', 
            'document-provider'
        ];

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            for (const f of forbidden) {
                const regex = new RegExp(`from\\s+['"][^'"]*${f}[^'"]*['"]`);
                if (regex.test(content)) {
                    failedFiles.push(`${file} (imported ${f})`);
                }
            }
        }

        expect(failedFiles, 'LU Application MUST NOT import adapters/UI directly. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });

    it('Regel 3: UI får inte importera artifact-store eller LU-regler', () => {
        const uiPackages = ['mps-ui-contract', 'ui-lu-workspace']; // Including ui-lu-workspace if it exists
        const failedFiles: string[] = [];

        for (const pkg of uiPackages) {
            const pkgDir = path.join(packagesDir, pkg, 'src');
            // Depending on repo layout, UI might also be in components/
            // But let's check packages first
            const files = walkSync(pkgDir);
            
            // Let's also check global components if needed
            const componentsDir = path.join(rootDir, 'components');
            const allFiles = [...files, ...walkSync(componentsDir)];

            for (const file of allFiles) {
                const content = fs.readFileSync(file, 'utf-8');
                const forbidden = [
                    'mps-artifact-store',
                    'mps-lu/rules'
                ];

                for (const f of forbidden) {
                    const regex = new RegExp(`from\\s+['"][^'"]*${f}[^'"]*['"]`);
                    if (regex.test(content)) {
                        failedFiles.push(`${file} (imported ${f})`);
                    }
                }
            }
        }

        expect(failedFiles, 'UI MUST NOT import artifact-store or LU rules directly. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });
});

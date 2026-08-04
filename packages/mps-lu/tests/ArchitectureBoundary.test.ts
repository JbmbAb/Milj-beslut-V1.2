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

describe('Phase 23: Architecture Boundary Constitutional Invariants', () => {

    const rootDir = path.resolve(__dirname, '../../../');

    it('ARCH-27-I1: Frozen Core SHALL NOT depend on domain packages', () => {
        // Define Frozen Core packages (the truth engine)
        const frozenCorePackages = [
            'mps-compliance',
            'mps-artifact-store',
            'mps-canonical',
            'mps-governance'
        ];

        let failedFiles: string[] = [];

        for (const pkg of frozenCorePackages) {
            const pkgDir = path.join(rootDir, pkg, 'src');
            const files = walkSync(pkgDir);

            for (const file of files) {
                const content = fs.readFileSync(file, 'utf-8');
                // Regex checks for imports like: import * from "mps-lu" or import { X } from "@miljobeslut/mps-lu"
                if (/from\s+['"]([^'"]*mps-lu[^'"]*)['"]/.test(content)) {
                    failedFiles.push(file);
                }
            }
        }

        expect(failedFiles, 'ARCH-27-I1 Failed: Frozen core MUST NOT import mps-lu. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });

    it('ARCH-27-I3: Domain applications SHALL NOT depend on infrastructure providers', () => {
        const luDir = path.join(rootDir, 'mps-lu', 'src');
        const files = walkSync(luDir);

        let failedFiles: string[] = [];

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            
            // Check for forbidden reality-layer imports
            const forbidden = [
                'ui-lu-workspace', 
                'mps-ui-contract',
                'spatial-provider-postgis', 
                'document-provider'
            ];

            for (const f of forbidden) {
                const regex = new RegExp(`from\\s+['"][^'"]*${f}[^'"]*['"]`);
                if (regex.test(content)) {
                    failedFiles.push(`${file} (imported ${f})`);
                }
            }
        }

        expect(failedFiles, 'ARCH-27-I3 Failed: Domain applications MUST NOT import infrastructure. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });

    it('ARCH-27-I5: Presentation layers SHALL consume projections only', () => {
        // Assuming UI code is somewhere, e.g. packages/mps-ui-contract, or just scan globally outside frozen core
        // For strictness, let's scan mps-ui-contract and anything resembling UI
        const uiPackages = ['mps-ui-contract'];
        let failedFiles: string[] = [];

        for (const pkg of uiPackages) {
            const pkgDir = path.join(rootDir, pkg, 'src');
            const files = walkSync(pkgDir);

            for (const file of files) {
                const content = fs.readFileSync(file, 'utf-8');
                
                // Check for forbidden logic-layer imports
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

        expect(failedFiles, 'ARCH-27-I5 Failed: Presentation layers MUST NOT import artifact-store or LU rules directly. Found violations in: ' + failedFiles.join(', ')).toHaveLength(0);
    });
});

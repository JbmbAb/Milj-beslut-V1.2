import fetch from "node-fetch";

const url = "https://apimanager.lantmateriet.se/api/am/devportal/v3/apis/8e4e3f62-99f4-4734-8faf-5b3245d3baa8/swagger?accessToken=ca7f1f3c-1554-3376&X-WSO2-Tenant-Q=&environmentName=Production%20and%20Sandbox";

async function run() {
    try {
        const res = await fetch(url);
        const data = await res.json() as any;

        // find any path containing registerenhet but not omradesytor/punkter/linjer
        const paths = Object.keys(data.paths);
        const registerPaths = paths.filter(p => p.includes('registerenhet') && !p.includes('omrade'));
        console.log("Found paths:", registerPaths);

        for (const p of registerPaths) {
            const getParams = data.paths[p].get?.parameters;
            if (getParams) {
                console.log(`Params for ${p}:`, getParams.map((x: any) => x.name || x.$ref).join(', '));
            }
        }
    } catch (err) {
        console.error(err);
    }
}

run();

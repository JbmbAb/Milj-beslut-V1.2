import fetch from "node-fetch";

const url = "https://apimanager.lantmateriet.se/api/am/devportal/v3/apis/8e4e3f62-99f4-4734-8faf-5b3245d3baa8/swagger?accessToken=ca7f1f3c-1554-3376&X-WSO2-Tenant-Q=&environmentName=Production%20and%20Sandbox";

async function run() {
    try {
        const res = await fetch(url);
        const data = await res.json() as any;

        console.log("Servers:");
        console.log(JSON.stringify(data.servers, null, 2));

        const paths = Object.keys(data.paths || {});
        // Find paths related to fastighetsindelning, registerenhet, or items
        const relevantPaths = paths.filter(p =>
            p.includes("fastighet") ||
            p.includes("register") ||
            (p.includes("items") && !p.includes("hydrografi") && !p.includes("marktacke") && !p.includes("stac") && !p.includes("ortnamn"))
        );

        for (const p of relevantPaths) {
            const getPath = data.paths[p].get;
            if (!getPath) continue;

            console.log(`\nPath: ${p}`);
            console.log(`  Description: ${getPath.summary || getPath.description}`);

            const params = getPath.parameters || [];
            const paramNames = params.map((x: any) => {
                if (x.name) return x.name;
                if (x.$ref) return x.$ref.split('/').pop();
                return "unknown";
            });
            console.log(`  Params: ${paramNames.join(", ")}`);
        }
    } catch (err) {
        console.error(err);
    }
}

run();

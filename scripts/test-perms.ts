import fetch from 'node-fetch';

const keys = [
    "SKZKkrKyc51vZHsl6xuW5a36eM8a",
    "SKZkKrKyc51vZHsI6xuW5a36eM8a",
    "SKZKkrKyc5lvZHsl6xuW5a36eM8a"
];

const secrets = [
    "BumpSXKUipqDUjub7S6I5YetIfEa",
    "BumpSXKUipqDUjub7S6l5YetIfEa",
    "Bump5XKUipqDUJub7S6l5YetiIEa"
];

async function run() {
    for (const k of keys) {
        for (const s of secrets) {
            const b64 = Buffer.from(k + ':' + s).toString('base64');
            const r = await fetch('https://apimanager.lantmateriet.se/oauth2/token', {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + b64,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            });
            const data = await r.json() as any;
            if (!data.error) {
                console.log("SUCCESS WITH:", k, s);
                return;
            }
        }
    }
    console.log("ALL FAILED");
}
run();

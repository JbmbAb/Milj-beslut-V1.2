import fetch from 'node-fetch';

const key = "SKZKkrKyc51vZHsl6xuW5a36eM8a";
const secret = "BumpSXKUipqDUjub7S6l5YetlfEa";
const b64 = Buffer.from(key + ":" + secret).toString('base64');

fetch("https://apimanager.lantmateriet.se/oauth2/token", {
    method: "POST",
    headers: {
        "Authorization": "Basic " + b64,
        "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
}).then(r => r.json()).then(console.log).catch(console.error);

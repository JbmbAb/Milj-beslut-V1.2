import fetch from "node-fetch";

const token = "eyJ4NXQiOiJPVEk1TjJRMVltWmlOekkxT0RjMVlUVTJNREZsT0RVNU9EUTRPVE15WVdRMFkyVXpOamN5T1EiLCJraWQiOiJNVE5tTkRNeVpHSmxOakJrTXpoallqTm1ZMlV5Tm1Ka1lUQTROR0ZoTmpNMU1ETmpabVJoTjJGbVkySTJOVGc0TmpKbVl6ZGxZamhqWkRFeFpURTVOd19SUzI1NiIsInR5cCI6ImF0K2p3dCIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJicnVjMDAwMSIsImF1dCI6IkFQUExJQ0FUSU9OIiwiYXVkIjoiU0taS2tyS3ljNTF2WkhzSTZ4dVc1YTM2ZU04YSIsIm5iZiI6MTc3Mjc0NjAyMywiYXpwIjoiU0taS2tyS3ljNTF2WkhzSTZ4dVc1YTM2ZU04YSIsInNjb3BlIjoiZGVmYXVsdCIsImlzcyI6Imh0dHBzOlwvXC9hcGltYW5hZ2VyLmxhbnRtYXRlcmlldC5zZSIsImV4cCI6MTc3Mjc0OTYyMywiaWF0IjoxNzcyNzQ2MDIzLCJqdGkiOiI1YTA4OGJiMC1lZjk5LTQ0M2YtYTZkYy04ZTFhZTYzZDNmYzMiLCJjbGllbnRfaWQiOiJTS1pLa3JLeWM1MXZaSHNJNnh1VzVhMzZlTThhIn0.HcjY8-0p_yndSI9_Rz11IWpl892u-pJagt71SQBW91y5zsgUUE-lIFiDgvmHlTFQHPpOmyaK3w9Eb4iM5LuXFFAvsNhS-_F7S7sDu-mcBPFfLK685Zxxxm8xqTMZ4ofJH5z5Up9MxEIQ_ZCSXbgdV5F0xIiOrSOANJbL07_4XRhRlwYVhN-fEbOtZv8uqp5j4ShT6WqVfEQ94fRS0pjhEZz98SF56gMuqwnvAOS15pqrvyx6b8nQgEFOATO5QPVC_VnSLRUzLHPpQNFWGM4ssbxoRgl0zvvqdKOOTeA7G2HkgHDvVpET9JAromzac9uqK0klEcPareQsfFAX1G-VSQ";

async function run() {
    const baseUrl = "https://api.lantmateriet.se/ogc-features/v1";
    const searchUrl = `${baseUrl}/fastighetsindelning/collections/registerenhetsomradesytor/items?kommunnamn=Nacka&trakt=Orminge&block=7&enhet=8&f=json&limit=1`;

    console.log("Fetching: " + searchUrl);
    try {
        const res = await fetch(searchUrl, {
            headers: { Authorization: "Bearer " + token }
        });
        console.log("Status: " + res.status);
        const data = await res.json() as any;
        console.log("Features found: " + data.features?.length);
        if (data.features?.length) {
            console.log("First feature designation: " + data.features[0].properties.etikett);
        } else {
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error(err);
    }
}

run();

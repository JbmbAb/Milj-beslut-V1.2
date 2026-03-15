
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('ERROR: GEMINI_API_KEY NOT FOUND');
        process.exit(1);
    }
    console.log('API Key starts with:', apiKey.slice(0, 5));
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        console.log('Trying gemini-1.5-flash...');
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Svara "HEJ" om du ser detta.');
        console.log('Gemini response:', result.response.text());
    } catch (e: any) {
        console.error('gemini-1.5-flash failed:', e.message);

        try {
            console.log('Trying gemini-2.5-flash...');
            const modelPro = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const resultPro = await modelPro.generateContent('Svara "HEJ" om du ser detta.');
            console.log('Gemini response (2.5):', resultPro.response.text());
        } catch (e2: any) {
            console.error('gemini-2.5-flash failed:', e2.message);
        }
    }
}

main().catch(console.error);

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function main() {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Hi');
        console.log('gemini-1.5-flash OK');
    } catch (e) {
        console.log('gemini-1.5-flash FAILED', e.message);
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
        const result = await model.generateContent('Hi');
        console.log('gemini-1.5-flash-latest OK');
    } catch (e) {
        console.log('gemini-1.5-flash-latest FAILED', e.message);
    }
}

main();

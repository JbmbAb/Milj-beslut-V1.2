import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
    try {
        await genAI.getGenerativeModel({ model: 'gemini-2.5-pro' }).generateContent('test');
        console.log('gemini-2.5-pro OK');
    } catch (e) {
        console.log('gemini-2.5-pro FAILED:', e);
    }
}
listModels();

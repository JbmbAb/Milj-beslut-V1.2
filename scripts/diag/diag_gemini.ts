import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function checkModel(name: string) {
    try {
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent("hi");
        console.log(`SUCCESS [${name}]:`, result.response.text().slice(0, 50));
        return true;
    } catch (e: any) {
        console.log(`FAILED [${name}]:`, e.message);
        return false;
    }
}

async function run() {
    const models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro", "gemini-pro", "gemini-1.0-pro"];
    for (const m of models) {
        if (await checkModel(m)) {
            console.log(`\n>>> WORKING MODEL FOUND: ${m}`);
            process.exit(0);
        }
    }
    console.log("\n!!! NO WORKING MODELS FOUND WITH THIS KEY.");
}

run();

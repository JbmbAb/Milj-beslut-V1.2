import 'dotenv/config';
import fs from 'fs';
import dotenv from 'dotenv';

console.log('BOVERKET_API_KEY present in process.env:', !!process.env.BOVERKET_API_KEY);

if (fs.existsSync('.env.local')) {
    const local = dotenv.parse(fs.readFileSync('.env.local'));
    console.log('BOVERKET_API_KEY present in .env.local:', !!local.BOVERKET_API_KEY);
}

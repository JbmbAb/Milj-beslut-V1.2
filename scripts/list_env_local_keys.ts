import fs from 'fs';
import dotenv from 'dotenv';

if (fs.existsSync('.env.local')) {
    const env = dotenv.parse(fs.readFileSync('.env.local'));
    console.log('Keys in .env.local:', Object.keys(env));
} else {
    console.log('.env.local does not exist');
}

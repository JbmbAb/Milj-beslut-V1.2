import fs from 'fs';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env'));
console.log('Keys in .env:', Object.keys(env));

const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../node_modules/cesium/Build/Cesium');
const destDir = path.resolve(__dirname, '../public/cesium');

console.log('--- Copying Cesium Assets ---');
console.log('Source:', srcDir);
console.log('Destination:', destDir);

if (!fs.existsSync(srcDir)) {
  console.error('ERROR: Cesium build files not found in node_modules! Run npm install first.');
  process.exit(1);
}

// Ensure target directory exists
fs.mkdirSync(destDir, { recursive: true });

// Subdirectories we need to serve locally
const subDirs = ['Assets', 'Widgets', 'Workers', 'ThirdParty'];

subDirs.forEach((sub) => {
  const src = path.join(srcDir, sub);
  const dest = path.join(destDir, sub);

  if (fs.existsSync(src)) {
    console.log(`Copying "${sub}" to "${dest}"...`);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
  } else {
    console.warn(`WARNING: Source folder not found: ${src}`);
  }
});

console.log('Cesium assets successfully copied to public/cesium!');

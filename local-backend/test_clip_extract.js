// backend/test_clip_extract.js
const fs = require('fs');
const path = require('path');

const clipFilePath = path.join(__dirname, 'sync_folder', 'ado.clip');
const destPngPath = path.join(__dirname, 'thumbnails', 'thumb_ado.clip.png');

if (!fs.existsSync(clipFilePath)) {
    console.error("ado.clip file does not exist in sync_folder!");
    process.exit(1);
}

console.log("Reading ado.clip file into buffer...");
const buf = fs.readFileSync(clipFilePath);
console.log(`File size: ${buf.length} bytes`);

const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const pngTrailer = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

console.log("Searching for PNG signature in binary stream...");
const headerIdx = buf.indexOf(pngHeader);

if (headerIdx !== -1) {
    console.log(`PNG Header found at byte offset: ${headerIdx}`);
    const trailerIdx = buf.indexOf(pngTrailer, headerIdx);
    
    if (trailerIdx !== -1) {
        const endIdx = trailerIdx + pngTrailer.length;
        console.log(`PNG Trailer (IEND) found at byte offset: ${trailerIdx} (End index: ${endIdx})`);
        
        const pngBuf = buf.slice(headerIdx, endIdx);
        console.log(`Extracted PNG size: ${pngBuf.length} bytes`);
        
        if (!fs.existsSync(path.dirname(destPngPath))) {
            fs.mkdirSync(path.dirname(destPngPath), { recursive: true });
        }
        
        fs.writeFileSync(destPngPath, pngBuf);
        console.log(`SUCCESS: Extracted PNG thumbnail written to ${destPngPath}`);
    } else {
        console.log("PNG Trailer (IEND) not found!");
    }
} else {
    console.log("PNG Header not found in .clip file!");
}

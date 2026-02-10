#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SIZES = [16, 32, 64, 80] as const;

const ADDINS = {
  excel: { dir: resolve(ROOT, "packages/office-excel/src/assets"), r: 33, g: 115, b: 70 },
  powerpoint: { dir: resolve(ROOT, "packages/office-powerpoint/src/assets"), r: 183, g: 71, b: 42 },
  outlook: { dir: resolve(ROOT, "packages/office-outlook/src/assets"), r: 0, g: 120, b: 212 },
} as const;

/** Generate a minimal valid PNG file — solid color square. */
function createPng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  // PNG uses zlib-compressed IDAT chunks. We'll build uncompressed deflate blocks.
  // Each row: filter byte (0 = None) + RGB pixels
  const rowBytes = 1 + width * 3;
  const rawData = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowBytes;
    rawData[offset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  // Build uncompressed deflate stream (store blocks, max 65535 bytes each)
  const deflateChunks: number[] = [];
  let pos = 0;
  while (pos < rawData.length) {
    const remaining = rawData.length - pos;
    const blockSize = Math.min(remaining, 65535);
    const isLast = pos + blockSize >= rawData.length;
    deflateChunks.push(isLast ? 0x01 : 0x00); // BFINAL + BTYPE=00 (stored)
    deflateChunks.push(blockSize & 0xff, (blockSize >> 8) & 0xff);
    deflateChunks.push(~blockSize & 0xff, (~blockSize >> 8) & 0xff);
    for (let i = 0; i < blockSize; i++) {
      deflateChunks.push(rawData[pos + i]);
    }
    pos += blockSize;
  }

  // Wrap in zlib: CMF=0x78 FLK=0x01 + deflate + adler32
  const adler = adler32(rawData);
  const zlibData = new Uint8Array(2 + deflateChunks.length + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  zlibData.set(deflateChunks, 2);
  const adlerOff = 2 + deflateChunks.length;
  zlibData[adlerOff] = (adler >> 24) & 0xff;
  zlibData[adlerOff + 1] = (adler >> 16) & 0xff;
  zlibData[adlerOff + 2] = (adler >> 8) & 0xff;
  zlibData[adlerOff + 3] = adler & 0xff;

  // Build PNG
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const ihdr = buildChunk("IHDR", ihdrData(width, height));
  const idat = buildChunk("IDAT", zlibData);
  const iend = buildChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  png.set(signature, off);
  off += signature.length;
  png.set(ihdr, off);
  off += ihdr.length;
  png.set(idat, off);
  off += idat.length;
  png.set(iend, off);

  return png;
}

function ihdrData(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(13);
  const view = new DataView(buf.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  buf[8] = 8; // bit depth
  buf[9] = 2; // color type: RGB
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace
  return buf;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return chunk;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Main
let count = 0;
for (const [name, { dir, r, g, b }] of Object.entries(ADDINS)) {
  mkdirSync(dir, { recursive: true });
  for (const size of SIZES) {
    const png = createPng(size, size, r, g, b);
    const file = resolve(dir, `icon-${size}.png`);
    writeFileSync(file, png);
    count++;
  }
  console.log(`Generated icons for ${name} → ${dir}`);
}
console.log(`\n${count} icon files created.`);

// Dependency-free, cross-platform .tar.gz handling (no external `tar`/`gzip` binary, no npm deps).
// Used by sync-skills.mjs (maintainer) and install-skills.mjs (optional user install) so both work
// identically on Windows, macOS, and Linux.
//
// Scope: parses the standard ustar/GNU/pax tarballs that GitHub `codeload` produces. Handles regular
// files, directories, GNU long names ('L'), and pax path records ('x'/'g'). Symlinks and other exotic
// entry types are skipped. Base-256 sizes (multi-GB entries) are not needed here and are not supported.
import { gunzipSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BLOCK = 512;

// Read a NUL-terminated string from a fixed-width header field.
function readStr(buf, start, len) {
  let end = start;
  const stop = start + len;
  while (end < stop && buf[end] !== 0) end++;
  return buf.toString('utf8', start, end);
}

/**
 * Download a GitHub tarball (repo@ref) and return the gunzipped tar bytes as a Buffer.
 * Public codeload endpoint — no auth. Throws on a non-2xx response.
 */
export async function fetchTarGz(repo, ref) {
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`could not download ${repo}@${ref} (HTTP ${res.status})`);
  const gz = Buffer.from(await res.arrayBuffer());
  return { url, tar: gunzipSync(gz) };
}

/**
 * Extract a (gunzipped) tar Buffer into destDir, preserving the archive's directory structure.
 * Returns the absolute path of the single top-level directory (GitHub tarballs wrap everything in
 * one `<repo>-<ref>/` dir), or destDir if there isn't exactly one.
 */
export async function extractTarToDir(tar, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  let offset = 0;
  let longName = null; // pending GNU 'L' long name
  let paxPath = null; // pending pax path= record

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker

    let name = readStr(header, 0, 100);
    const prefix = readStr(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const sizeOctal = readStr(header, 124, 12).trim().replace(/[^0-7]/g, '');
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const modeOctal = readStr(header, 100, 8).trim().replace(/[^0-7]/g, '');
    const mode = modeOctal ? parseInt(modeOctal, 8) & 0o777 : null; // preserve the exec bit (git tracks it)
    const typeflag = String.fromCharCode(header[156]); // '0'/'\0' file, '5' dir, 'L' longname, 'x'/'g' pax

    offset += BLOCK;
    const dataStart = offset;
    offset += Math.ceil(size / BLOCK) * BLOCK; // advance past padded data

    if (typeflag === 'L') {
      longName = readStr(tar, dataStart, size).replace(/\0+$/, '');
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      const record = tar.toString('utf8', dataStart, dataStart + size);
      const m = record.match(/\d+ path=([^\n]+)\n/);
      if (m) paxPath = m[1];
      continue;
    }

    const entryName = (paxPath || longName || name).replace(/\/+$/, (s) => s); // keep trailing slash meaning
    longName = null;
    paxPath = null;
    if (!entryName) continue;

    const outPath = path.join(destDir, entryName);
    const rel = path.relative(destDir, outPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // guard against path traversal

    if (typeflag === '5' || entryName.endsWith('/')) {
      await fs.mkdir(outPath, { recursive: true });
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '' || typeflag === '7') {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, tar.subarray(dataStart, dataStart + size));
      // Preserve the archived permission bits so the executable bit survives (git tracks it).
      // On Windows chmod only toggles read-only, which is harmless here.
      if (mode !== null) await fs.chmod(outPath, mode);
    }
    // other typeflags (symlink '2', etc.) are intentionally skipped
  }

  const dirs = (await fs.readdir(destDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return dirs.length === 1 ? path.join(destDir, dirs[0]) : destDir;
}

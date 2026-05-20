#!/usr/bin/env node
// =============================================================================
// Manna — passcode hasher (v0.1.3)
// =============================================================================
// Generates an scrypt hash for a plaintext passcode, in the format expected
// by lib/crypto.js. Run from anywhere; only depends on Node built-ins.
//
//   node scripts/hash-passcode.cjs
//
// Prompts for the passcode (input is visible — this script is for trusted
// local use; pipe through `read -s` in a shell if you need it hidden).
// Prints the hash string to stdout; everything else goes to stderr so you
// can capture the hash cleanly with:
//
//   node scripts/hash-passcode.cjs > /tmp/hash.txt
//
// Plaintext is never written to disk, and never leaves this machine.
// =============================================================================

const { scrypt, randomBytes } = require('node:crypto');
const { promisify } = require('node:util');
const readline = require('node:readline');

const scryptAsync = promisify(scrypt);

// Must match lib/crypto.js.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

async function hashPasscode(plaintext) {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join(':');
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const passcode = await new Promise((res) => {
    process.stderr.write('Enter passcode (input will be visible): ');
    rl.question('', (answer) => {
      rl.close();
      res(answer);
    });
  });
  const trimmed = String(passcode).trim();
  if (!trimmed) {
    process.stderr.write('No passcode entered. Aborting.\n');
    process.exit(1);
  }
  const hash = await hashPasscode(trimmed);
  process.stderr.write('\nHash (paste this into the SQL — value of passcode_hash):\n\n');
  process.stdout.write(hash + '\n');
}

main().catch((err) => {
  process.stderr.write('Error: ' + (err && err.message ? err.message : err) + '\n');
  process.exit(1);
});

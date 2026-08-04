import { existsSync, readFileSync } from 'node:fs'

const strict = process.argv.includes('--strict')
const failures = []
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const config = readFileSync('electron-builder.production.yml', 'utf8')

const requiredFiles = [
  'build/icon.icns',
  'build/entitlements.mac.plist',
  'build/entitlements.mac.inherit.plist',
  'electron-builder.production.yml',
  'scripts/release/create-manifest.mjs',
]

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`missing release input: ${file}`)
}

if (/Astrolabe Dev/.test(config)) failures.push('production config references the development identity')
if (!/forceCodeSigning:\s*true/.test(config)) failures.push('production config must force code signing')
if (!/notarize:\s*true/.test(config)) failures.push('production config must enable notarization')
if (!/target:\s*dmg/.test(config)) failures.push('production config must build a DMG')
if (!/arm64/.test(config)) failures.push('production config must identify the qualified arm64 architecture')

if (strict) {
  const tag = process.env.RELEASE_TAG ?? ''
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) failures.push('RELEASE_TAG must be an existing vX.Y.Z tag')
  if (pkg.version === '0.0.0' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    failures.push('package.json must contain a nonzero stable semver')
  }
  if (tag && tag !== `v${pkg.version}`) {
    failures.push(`tag ${tag} does not match package version v${pkg.version}`)
  }
  if (!existsSync('LICENSE') && !existsSync('EULA.md')) {
    failures.push('add reviewed distribution terms as LICENSE or EULA.md before packaging')
  }

  for (const variable of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'APPLE_TEAM_ID',
  ]) {
    if (!process.env[variable]) failures.push(`missing production secret: ${variable}`)
  }
  if (process.env.APPLE_API_KEY && !existsSync(process.env.APPLE_API_KEY)) {
    failures.push('APPLE_API_KEY must point to the materialized App Store Connect key')
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log(strict ? 'Production release preflight passed.' : 'Dormant release configuration is complete.')

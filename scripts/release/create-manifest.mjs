import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = process.env.RELEASE_TAG ?? `v${pkg.version}`
const artifact = join('dist', `Astrolabe-${pkg.version}-arm64.dmg`)
const bytes = readFileSync(artifact)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

writeFileSync(join('dist', 'SHA256SUMS.txt'), `${sha256}  ${basename(artifact)}\n`)
writeFileSync(
  join('dist', 'release-manifest.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    product: 'Astrolabe',
    version: pkg.version,
    tag,
    platform: 'macos',
    architecture: 'arm64',
    bundleId: 'cool.astrolabe.app',
    artifact: basename(artifact),
    sha256,
    signed: true,
    notarized: true,
    commit,
  }, null, 2)}\n`,
)

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const landingRoot = resolve('site')
const docsRoot = resolve('build/wiki-site')
const outputRoot = resolve(process.argv[2] ?? 'build/pages')

for (const [label, path] of [['landing site', landingRoot], ['documentation build', docsRoot]]) {
  if (!existsSync(path)) {
    console.error('Missing ' + label + ': ' + path)
    process.exit(1)
  }
}

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })
cpSync(landingRoot, outputRoot, { recursive: true })

const docsOutput = join(outputRoot, 'docs')
rmSync(docsOutput, { recursive: true, force: true })
cpSync(docsRoot, docsOutput, { recursive: true })

console.log('Assembled landing page and documentation in ' + outputRoot)

#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const artifactDefinitions = {
  windows: [
    { suffix: '.msi', outputName: 'VaporLensDB.msi' },
    { suffix: '.exe', outputName: 'VaporLensDB-Setup.exe' },
  ],
  linux: [
    { suffix: '.appimage', outputName: 'VaporLensDB.AppImage' },
    { suffix: '.deb', outputName: 'VaporLensDB.deb' },
    { suffix: '.rpm', outputName: 'VaporLensDB.rpm' },
  ],
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

function isWithin(parent, child) {
  const pathFromParent = relative(resolve(parent), resolve(child))
  return pathFromParent !== '' && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent)
}

export async function stageArtifacts({ platform, bundleDir, artifactDir, allowedArtifactRoot }) {
  const definitions = artifactDefinitions[platform]
  if (!definitions) {
    throw new Error(`Unsupported artifact platform: ${platform}`)
  }

  if (allowedArtifactRoot && !isWithin(allowedArtifactRoot, artifactDir)) {
    throw new Error(`Refusing to replace artifact directory outside ${allowedArtifactRoot}: ${artifactDir}`)
  }

  const files = await listFiles(bundleDir)
  const selected = definitions.map((definition) => {
    const matches = files.filter((path) => path.toLowerCase().endsWith(definition.suffix))
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${definition.suffix} artifact, found ${matches.length}: ${matches.join(', ') || 'none'}`)
    }
    return { ...definition, sourcePath: matches[0] }
  })

  await rm(artifactDir, { recursive: true, force: true })
  await mkdir(artifactDir, { recursive: true })

  const checksumLines = []
  for (const artifact of selected) {
    const destination = join(artifactDir, artifact.outputName)
    await copyFile(artifact.sourcePath, destination)
    await chmod(destination, (await stat(artifact.sourcePath)).mode)
    const hash = createHash('sha256').update(await readFile(destination)).digest('hex')
    checksumLines.push(`${hash}  ${artifact.outputName}`)
  }

  const checksumPath = join(artifactDir, 'SHA256SUMS.txt')
  await writeFile(checksumPath, `${checksumLines.join('\n')}\n`)
  return [...selected.map((artifact) => join(artifactDir, artifact.outputName)), checksumPath]
}

async function main() {
  const [platform, bundleDir, artifactDir] = process.argv.slice(2)
  if (!platform || !bundleDir || !artifactDir) {
    throw new Error('Usage: node scripts/stage-build-artifacts.mjs <windows|linux> <bundle-dir> <artifact-dir>')
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(scriptDir, '..')
  const expectedBundleRoot = join(repositoryRoot, 'src-tauri', 'target', 'release', 'bundle')
  if (resolve(bundleDir) !== expectedBundleRoot) {
    throw new Error(`Unexpected Tauri bundle directory: ${bundleDir}`)
  }

  const outputPaths = await stageArtifacts({
    platform,
    bundleDir,
    artifactDir,
    allowedArtifactRoot: join(repositoryRoot, 'artifacts'),
  })
  process.stdout.write(`${outputPaths.join('\n')}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

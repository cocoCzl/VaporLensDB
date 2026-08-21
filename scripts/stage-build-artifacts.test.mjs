import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { stageArtifacts } from './stage-build-artifacts.mjs'

async function fixture(platform, files) {
  const root = await mkdtemp(join(tmpdir(), `vaporlensdb-${platform}-artifacts-`))
  const bundleDir = join(root, 'bundle')
  const artifactDir = join(root, 'artifacts', platform, 'x86_64')
  await mkdir(bundleDir, { recursive: true })
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'stale-installer.bin'), 'stale')

  for (const [name, contents] of Object.entries(files)) {
    const path = join(bundleDir, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents)
  }

  return { root, bundleDir, artifactDir }
}

test('stages fixed-name Windows artifacts and replaces stale output', async (context) => {
  const paths = await fixture('windows', {
    'msi/VaporLensDB_0.8.3_x64_en-US.msi': 'msi-package',
    'nsis/VaporLensDB_0.8.3_x64-setup.exe': 'nsis-package',
  })
  context.after(() => rm(paths.root, { recursive: true, force: true }))

  await stageArtifacts({ platform: 'windows', ...paths })

  await assert.rejects(readFile(join(paths.artifactDir, 'stale-installer.bin')))
  assert.equal(await readFile(join(paths.artifactDir, 'VaporLensDB.msi'), 'utf8'), 'msi-package')
  assert.equal(await readFile(join(paths.artifactDir, 'VaporLensDB-Setup.exe'), 'utf8'), 'nsis-package')
  const checksum = await readFile(join(paths.artifactDir, 'SHA256SUMS.txt'), 'utf8')
  const expectedHash = createHash('sha256').update('msi-package').digest('hex')
  assert.match(checksum, new RegExp(`^${expectedHash}  VaporLensDB\\.msi$`, 'm'))
})

test('stages AppImage, DEB, and RPM using fixed Linux names', async (context) => {
  const paths = await fixture('linux', {
    'appimage/vapor-lens-db_0.8.3_amd64.AppImage': 'appimage-package',
    'deb/vapor-lens-db_0.8.3_amd64.deb': 'deb-package',
    'rpm/VaporLensDB-0.8.3-1.x86_64.rpm': 'rpm-package',
  })
  context.after(() => rm(paths.root, { recursive: true, force: true }))
  await chmod(join(paths.bundleDir, 'appimage/vapor-lens-db_0.8.3_amd64.AppImage'), 0o755)

  const outputPaths = await stageArtifacts({ platform: 'linux', ...paths })

  assert.deepEqual(outputPaths.map((path) => basename(path)), [
    'VaporLensDB.AppImage',
    'VaporLensDB.deb',
    'VaporLensDB.rpm',
    'SHA256SUMS.txt',
  ])
  assert.notEqual((await stat(join(paths.artifactDir, 'VaporLensDB.AppImage'))).mode & 0o111, 0)
})

test('fails before replacing output when an artifact is missing or ambiguous', async (context) => {
  const missing = await fixture('windows', {
    'msi/VaporLensDB_0.8.3_x64_en-US.msi': 'msi-package',
  })
  const duplicate = await fixture('windows', {
    'msi/one.msi': 'one',
    'msi/two.msi': 'two',
    'nsis/setup.exe': 'setup',
  })
  context.after(() => Promise.all([
    rm(missing.root, { recursive: true, force: true }),
    rm(duplicate.root, { recursive: true, force: true }),
  ]))

  await assert.rejects(stageArtifacts({ platform: 'windows', ...missing }), /exactly one \.exe artifact, found 0/)
  await assert.rejects(stageArtifacts({ platform: 'windows', ...duplicate }), /exactly one \.msi artifact, found 2/)
  assert.equal(await readFile(join(missing.artifactDir, 'stale-installer.bin'), 'utf8'), 'stale')
})

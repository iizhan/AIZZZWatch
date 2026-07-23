import { packager } from '@electron/packager'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile, cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'out')
const iconPath = join(root, 'assets', 'icon.icns')

function log(message) {
  process.stdout.write(`[package:mac] ${message}\n`)
}

function logHook(name) {
  return async ({ buildPath }) => {
    log(`${name}: ${buildPath}`)
  }
}

function resolveElectronVersion(packageJson) {
  const version = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  if (typeof version !== 'string') {
    throw new Error('electron dependency is missing from package.json')
  }
  return version.replace(/^[^\d]*/, '')
}

async function assertRequiredBuildOutput() {
  await stat(join(outDir, 'main', 'index.js'))
  await stat(join(outDir, 'preload', 'index.cjs'))
  await stat(join(outDir, 'renderer', 'index.html'))
  await stat(iconPath)
}

async function createStagingApp() {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const stagingDir = await mkdtemp(join(tmpdir(), 'aizzzwatch-package-'))
  const stagingPackageJson = {
    name: packageJson.name,
    productName: packageJson.productName,
    version: packageJson.version,
    description: packageJson.description,
    main: 'out/main/index.js',
    type: 'module'
  }

  await mkdir(join(stagingDir, 'out'), { recursive: true })
  await cp(outDir, join(stagingDir, 'out'), { recursive: true })
  await writeFile(join(stagingDir, 'package.json'), `${JSON.stringify(stagingPackageJson, null, 2)}\n`)
  return stagingDir
}

async function createLocalElectronZip(stagingDir, electronVersion) {
  const electronAppPath = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
  await stat(electronAppPath)

  const zipDir = join(stagingDir, 'electron-zip')
  const zipPath = join(zipDir, `electron-v${electronVersion}-darwin-${process.arch}.zip`)
  await mkdir(zipDir, { recursive: true })

  log('electron zip start')
  const zipResult = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', electronAppPath, zipPath], {
    stdio: 'inherit'
  })

  if (zipResult.status !== 0) {
    throw new Error('electron zip failed')
  }

  log(`electron zip complete: ${zipPath}`)
  return zipDir
}

await assertRequiredBuildOutput()
const rootPackageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const electronVersion = resolveElectronVersion(rootPackageJson)
const stagingDir = await createStagingApp()
const electronZipDir = await createLocalElectronZip(stagingDir, electronVersion)

try {
  log(`staging: ${stagingDir}`)
  const [releaseDir] = await packager({
    dir: stagingDir,
    out: join(root, 'release'),
    name: 'AIZZZWatch',
    productName: 'AIZZZWatch',
    platform: 'darwin',
    arch: process.arch,
    electronVersion,
    electronZipDir,
    overwrite: true,
    asar: true,
    prune: false,
    quiet: true,
    appBundleId: 'com.aizzzwatch.desktop',
    appCategoryType: 'public.app-category.utilities',
    icon: iconPath,
    beforeCopy: [logHook('before copy')],
    afterCopy: [logHook('after copy')],
    beforeAsar: [logHook('before asar')],
    afterAsar: [logHook('after asar')],
    afterComplete: [logHook('after complete')]
  })

  const appPath = join(releaseDir, 'AIZZZWatch.app')
  log('codesign start')
  const signResult = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
    stdio: 'inherit'
  })

  if (signResult.status !== 0) {
    throw new Error('codesign failed')
  }

  log('codesign complete')
  process.stdout.write(`${appPath}\n`)
} finally {
  await rm(stagingDir, { recursive: true, force: true })
}

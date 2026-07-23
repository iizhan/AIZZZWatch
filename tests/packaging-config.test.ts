import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  scripts: Record<string, string>
  devDependencies: Record<string, string>
  build: {
    appId: string
    directories: { output: string }
    extraResources: Array<{ from: string; to: string; filter: string[] }>
    mac: { icon: string; identity: string; hardenedRuntime: boolean }
    win: { icon: string; target: Array<{ target: string; arch: string[] }> }
    nsis: { oneClick: boolean; perMachine: boolean }
  }
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageManifest

describe('cross-platform packaging configuration', () => {
  it('keeps the existing mac app package and adds DMG and Windows NSIS commands', () => {
    expect(manifest.scripts['package:mac']).toContain('scripts/package-mac.mjs')
    expect(manifest.scripts['package:dmg']).toBe('npm run build && electron-builder --mac dmg --arm64')
    expect(manifest.scripts['package:win']).toBe('npm run build && electron-builder --win nsis --x64')
    expect(manifest.devDependencies['electron-builder']).toMatch(/^\^26\./)
  })

  it('ships the platform-native icon resources beside the packaged app', () => {
    expect(existsSync(resolve(root, 'assets', 'icon.icns'))).toBe(true)
    expect(existsSync(resolve(root, 'assets', 'icon.ico'))).toBe(true)
    expect(manifest.build.extraResources).toContainEqual({
      from: 'assets',
      to: 'assets',
      filter: ['icon.icns', 'icon.ico']
    })
  })

  it('targets an arm64 DMG and a per-user Windows x64 NSIS installer', () => {
    expect(manifest.build.appId).toBe('com.aizzzwatch.desktop')
    expect(manifest.build.directories.output).toBe('release')
    expect(manifest.build.mac.icon).toBe('assets/icon.icns')
    expect(manifest.build.mac.identity).toBe('-')
    expect(manifest.build.mac.hardenedRuntime).toBe(false)
    expect(manifest.build.win.icon).toBe('assets/icon.ico')
    expect(manifest.build.win.target).toContainEqual({ target: 'nsis', arch: ['x64'] })
    expect(manifest.build.nsis).toMatchObject({ oneClick: true, perMachine: false })
  })
})

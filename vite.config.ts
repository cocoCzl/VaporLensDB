import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'path'

const monacoVsDir = path.resolve(__dirname, 'node_modules/monaco-editor/min/vs')
const monacoLanguageIds = ['sql', 'pgsql']

export default defineConfig({
  plugins: [react(), monacoStaticAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  build: {
    chunkSizeWarningLimit: 4200,
    modulePreload: false,
  },
})

function monacoStaticAssetsPlugin(): Plugin {
  let outDir = path.resolve(__dirname, 'dist')

  return {
    name: 'monaco-static-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/monaco/vs', (req, res, next) => {
        if (!req.url) {
          next()
          return
        }

        const filePath = path.normalize(
          path.join(monacoVsDir, decodeURIComponent(req.url.split('?')[0])),
        )

        if (!isInside(monacoVsDir, filePath)) {
          res.statusCode = 403
          res.end()
          return
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next()
          return
        }

        res.setHeader('Content-Type', contentType(filePath))
        fs.createReadStream(filePath).pipe(res)
      })
    },
    writeBundle() {
      copyMonacoStaticAssets(path.join(outDir, 'monaco/vs'))
    },
  }
}

function copyMonacoStaticAssets(targetDir: string) {
  const files = collectMonacoStaticAssetFiles()
  fs.rmSync(targetDir, { recursive: true, force: true })

  for (const relativePath of files) {
    const source = path.join(monacoVsDir, relativePath)
    const target = path.join(targetDir, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function collectMonacoStaticAssetFiles() {
  const files = new Set<string>()
  const queue: string[] = []

  const enqueue = (relativePath: string) => {
    const normalized = normalizeRelative(relativePath)
    const source = path.join(monacoVsDir, normalized)
    if (!isInside(monacoVsDir, source) || files.has(normalized) || !fs.existsSync(source)) {
      return
    }
    files.add(normalized)
    if (normalized.endsWith('.js')) {
      queue.push(normalized)
    }
  }

  enqueue('loader.js')
  enqueue('editor/editor.main.js')
  enqueue('editor/editor.main.css')
  enqueue('basic-languages/monaco.contribution.js')
  enqueue('nls.messages-loader.js')
  enqueue('nls.messages.js.js')

  for (const languageId of monacoLanguageIds) {
    const chunk = findBasicLanguageChunk(languageId)
    if (chunk) {
      enqueue(chunk)
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    const source = path.join(monacoVsDir, current)
    const code = fs.readFileSync(source, 'utf8')
    const baseDir = path.dirname(current)

    for (const dependency of staticAmdDependencies(code)) {
      enqueue(resolveMonacoDependency(baseDir, dependency))
    }

    for (const asset of toUrlDependencies(code)) {
      if (asset.includes('/assets/') && !asset.includes('editor.worker')) {
        continue
      }
      enqueue(resolveMonacoDependency(baseDir, asset))
    }
  }

  return [...files].sort()
}

function staticAmdDependencies(code: string) {
  const matches = [...code.matchAll(/define\([^[]*\[([^\]]*)\]/g)]
  return matches.flatMap((match) => stringLiterals(match[1] ?? '')).filter((dependency) => {
    return dependency !== 'exports' && dependency !== 'require'
  })
}

function toUrlDependencies(code: string) {
  return [...code.matchAll(/toUrl\(["']([^"']+)["']\)/g)].map((match) => match[1])
}

function stringLiterals(value: string) {
  return [...value.matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
}

function resolveMonacoDependency(baseDir: string, dependency: string) {
  if (dependency === 'vs/nls.messages-loader!') {
    return 'nls.messages-loader.js'
  }

  let relativePath = dependency.startsWith('vs/')
    ? dependency.slice(3)
    : path.join(baseDir, dependency)

  const source = path.join(monacoVsDir, normalizeRelative(relativePath))
  if (!fs.existsSync(source) && fs.existsSync(`${source}.js`)) {
    relativePath += '.js'
  }

  return relativePath
}

function findBasicLanguageChunk(languageId: string) {
  const contribution = fs.readFileSync(
    path.join(monacoVsDir, 'basic-languages/monaco.contribution.js'),
    'utf8',
  )
  const escapedLanguageId = languageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `id:"${escapedLanguageId}"[\\s\\S]*?\\[["']\\.\\./([^"']+)["']\\]`,
  )
  const match = contribution.match(pattern)
  return match ? `${match[1]}.js` : null
}

function normalizeRelative(relativePath: string) {
  return path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
}

function isInside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function contentType(filePath: string) {
  if (filePath.endsWith('.js')) return 'text/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.ttf')) return 'font/ttf'
  if (filePath.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

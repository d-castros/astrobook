import fs from 'node:fs/promises'
import path from 'node:path'

import type { StoryModule } from '@astrobook/types'
import { fdir } from 'fdir'
import kebabCase from 'just-kebab-case'
import slash from 'slash'

import { getExports } from '../utils/get-exports'
import { invariant } from '../utils/invariant'

/**
 * List the absolute paths of all story files in the given directory.
 */
async function listStoryFiles(rootDir: string): Promise<string[]> {
  invariant(
    path.isAbsolute(rootDir),
    `Root directory must be absolute, but got '${rootDir}'`,
  )

  const filePaths = await new fdir()
    .withSymlinks()
    .withFullPaths()
    .normalize()
    .glob('./**/*.stories.{ts,tsx,js,jsx,mts,mtsx,mjs,mjsx}')
    .exclude((dirname) => dirname === 'node_modules')
    .crawl(rootDir)
    .withPromise()

  return filePaths.sort()
}

type ParsedStoryFile = {
  /**
   * The absolute path to the file. Unix-style slashes are used.
   */
  filePath: string

  /**
   * Whether the file has a default export
   */
  defaultExport: boolean

  /**
   * The named exports in the file
   */
  namedExports: string[]
}

async function parseStoryFiles(filePath: string): Promise<ParsedStoryFile> {
  const code = await fs.readFile(filePath, 'utf-8')
  const exports = getExports(code)
  const defaultExport = exports.includes('default')
  const namedExports = exports.filter((name) => name !== 'default')

  return { filePath, defaultExport, namedExports }
}

export async function convertStoryFileToModule(
  rootDir: string,
  file: ParsedStoryFile,
): Promise<StoryModule | undefined> {
  if (file.namedExports.length === 0) {
    console.warn(`[astrobook] File ${file.filePath} has no named exports`)
    return
  }

  if (!file.defaultExport) {
    console.warn(`[astrobook] File ${file.filePath} has no default export`)
    return
  }

  const relativePath = path.normalize(path.relative(rootDir, file.filePath))
  const relativePathWithoutStories = relativePath.replace(
    /\.stories\.\w+$/i,
    '',
  )
  const parts = relativePathWithoutStories.split(path.sep)

  const directory = parts.slice(0, -1).join('/')
  const name = parts.pop()
  invariant(name, `Unexpected file path: ${file.filePath}`)

  const moduleId = directory
    ? `${directory}/${kebabCase(name)}`
    : kebabCase(name)

  return {
    id: moduleId,
    name,
    directory,
    importPath: slash(file.filePath),
    stories: await Promise.all(
      file.namedExports.map(async (name) => {
        // Try to extract extraHtml from the story export
        let extraHtml = undefined;
        try {
          // Dynamically import the story file and get the extraHtml field if present
          const storyModule = await import(file.filePath);
          if (storyModule[name]?.args?.extraHtml) {
            extraHtml = storyModule[name].args.extraHtml;
          }
        } catch (e) {
          // ignore errors, extraHtml will be undefined
        }
        return { id: `${moduleId}/${kebabCase(name)}`, name, extraHtml }
      })
    ),
  }
}

export async function getStoryModules(rootDir: string): Promise<StoryModule[]> {
  const storyFilePaths = await listStoryFiles(rootDir)
  const storyFiles = await Promise.all(storyFilePaths.map(parseStoryFiles))

  const modules = await Promise.all(
    storyFiles.map((storyFile) => convertStoryFileToModule(rootDir, storyFile))
  )
  return modules.filter((module) => !!module) as StoryModule[]
}

import path from 'node:path'

import type { Story, StoryModule } from '@astrobook/types'
import type { AstroIntegrationLogger } from 'astro'
import slash from 'slash'

import { invariant } from '../utils/invariant'

import { getStoryModules } from './get-story-modules'

export interface VirtualRoute {
  pattern: string
  /**
   * The absolute path to the virtual entrypoint file. Posix slash format.
   *
   * It's important to use an absolute path here because we must ensure that we
   * only have one `id`, so that Astro's CSS plugin can find the correct CSS
   * content in the following line.
   * https://github.com/withastro/astro/blob/bc2796436dc3810e988c27b71b7a66fcb1ae8bda/packages/astro/src/core/build/plugins/plugin-css.ts#L144
   */
  entrypoint: string
  storyModule: StoryModule
  story: Story
  props: {
    hasSidebar: boolean
    story: string
  }
}

export async function getVirtualRoutes(
  rootDir: string,
  codegenDir: string,
  logger: AstroIntegrationLogger,
): Promise<Map<string, VirtualRoute>> {
  const routes: VirtualRoute[] = []
  const storyModules = await getStoryModules(rootDir)

  for (const storyModule of storyModules) {
    logger.debug(
      `Found ${storyModule.stories.length} stories in ${storyModule.importPath}`,
    )
    for (const story of storyModule.stories) {
      invariant(
        !story.id.startsWith('..'),
        `Story ID cannot start with '..', but got '${story.id}'`,
      )
      invariant(
        !story.id.startsWith('/'),
        `Story ID cannot start with '/', but got '${story.id}'`,
      )
      routes.push(
        {
          pattern: '/dashboard/' + story.id,
          entrypoint: slash(
            path.resolve(codegenDir, 'dashboard', story.id + '.astro'),
          ),
          storyModule,
          story,
          props: { hasSidebar: true, story: story.id },
        },
        {
          pattern: '/stories/' + story.id,
          entrypoint: slash(
            path.resolve(codegenDir, 'stories', story.id + '.astro'),
          ),
          storyModule,
          story,
          props: { hasSidebar: false, story: story.id },
        },
      )
    }
  }

  logger.info(`Found ${routes.length} stories in ${storyModules.length} files`)

  return new Map(routes.map((route) => [route.pattern, route]))
}

export function createVirtualRouteComponent(route: VirtualRoute, body:any): string {
  return `
---
import StoryPage from 'astrobook/pages/story.astro'
import { isAstroStory } from 'astrobook/client'
import * as m from '${route.storyModule.importPath}'

${body ? `import ExtraComp from '${body}'` : ''}

const isAstro = isAstroStory(m)
---

<StoryPage story={'${route.props.story}'} hasSidebar={${route.props.hasSidebar}}>
  {
    isAstro
      ? (<m.default.component { ...m['${route.story.name}']?.args } />)
      : (<m.default.component { ...m['${route.story.name}']?.args } client:load />)
  }


  ${body ? `<ExtraComp storyName={'${route.story.name}'} module={'${route.storyModule.name}'} modulePath={'${route.storyModule.directory}'} extraHtml={m['${route.story.name}']?.args?.extraHtml} />` : ''}

</StoryPage>
`.trim()
}

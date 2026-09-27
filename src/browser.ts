import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import type { BrowserActionStep, BrowserTarget, JsonValue } from './types.js'

export interface ActionAdapter {
  execute(step: BrowserActionStep, signal: AbortSignal): Promise<JsonValue | undefined>
  close(): Promise<void>
}

function abortError(): Error {
  const error = new Error('Run stopped')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function allowedOrigin(url: string, origins: Set<string>): boolean {
  if (url === 'about:blank') return true
  try {
    return origins.has(new URL(url).origin)
  } catch {
    return false
  }
}

export class PlaywrightAdapter implements ActionAdapter {
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private page: Page | undefined
  private blockedNavigation: Error | undefined
  private readonly origins: Set<string>

  constructor(
    origins: string[],
    private readonly headless = true
  ) {
    this.origins = new Set(origins)
  }

  private async getPage(): Promise<Page> {
    if (this.page) return this.page

    this.browser = await chromium.launch({ headless: this.headless })
    this.context = await this.browser.newContext()

    await this.context.route('**/*', async (route) => {
      const request = route.request()
      const frame = request.frame()
      const isTopLevelNavigation =
        request.isNavigationRequest() && frame === frame.page().mainFrame()

      if (isTopLevelNavigation && !allowedOrigin(request.url(), this.origins)) {
        this.blockedNavigation = new Error(
          `Navigation to undeclared origin is not allowed: ${new URL(request.url()).origin}`
        )
        await route.abort('blockedbyclient')
        return
      }

      await route.continue()
    })

    this.page = await this.context.newPage()
    this.context.on('page', (page) => {
      if (page !== this.page) void page.close().catch(() => undefined)
    })

    return this.page
  }

  private locator(page: Page, target: BrowserTarget): Locator {
    if ('selector' in target) return page.locator(target.selector)
    if ('id' in target) {
      const id = target.id.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      return page.locator(`[id="${id}"]`)
    }
    if ('text' in target) {
      return page.getByText(target.text, { exact: target.exact ?? false })
    }

    return page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
      ...(target.name !== undefined ? { name: target.name } : {}),
      exact: target.exact ?? false
    })
  }

  async execute(step: BrowserActionStep, signal: AbortSignal): Promise<JsonValue | undefined> {
    throwIfAborted(signal)
    if (this.blockedNavigation) throw this.blockedNavigation
    const page = await this.getPage()

    if (step.action === 'browser.goto') {
      const url = new URL(step.url)
      if (!this.origins.has(url.origin)) {
        throw new Error(`Navigation to undeclared origin is not allowed: ${url.origin}`)
      }
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      if (this.blockedNavigation) throw this.blockedNavigation
      if (!allowedOrigin(page.url(), this.origins)) {
        throw new Error(
          `Navigation to undeclared origin is not allowed: ${new URL(page.url()).origin}`
        )
      }
      return undefined
    }

    if (step.action === 'browser.fill') {
      await this.locator(page, step.target).fill(step.value)
      return undefined
    }

    if (step.action === 'browser.press') {
      await this.locator(page, step.target).press(step.key)
      return undefined
    }

    if (step.action === 'browser.click') {
      await this.locator(page, step.target).click()
      return undefined
    }

    if (step.action === 'browser.wait') {
      if (step.milliseconds !== undefined) {
        await page.waitForTimeout(step.milliseconds)
      } else if (step.target) {
        await this.locator(page, step.target).waitFor({
          state: step.state ?? 'visible',
          timeout: step.timeout ?? 10_000
        })
      }
      return undefined
    }

    if (step.action === 'browser.extract') {
      const locator = this.locator(page, step.target)
      const count = Math.min(await locator.count(), step.limit ?? 20)
      const rows: JsonValue[] = []
      let extractedBytes = 0

      for (let index = 0; index < count; index += 1) {
        throwIfAborted(signal)
        const row = await locator.nth(index).evaluate((element, fields) => {
          const result: Record<string, string | null> = {}
          for (const field of fields) {
            if (field === 'text') {
              result[field] = element.textContent?.trim() ?? null
            } else if (field === 'id') {
              result[field] = element.id || null
            } else if (field === 'href') {
              result[field] =
                element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href')
            } else if (field === 'value') {
              result[field] =
                element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                  ? element.value
                  : element.getAttribute('value')
            } else if (field === 'ariaLabel') {
              result[field] = element.getAttribute('aria-label')
            } else if (field === 'tagName') {
              result[field] = element.tagName.toLowerCase()
            } else if (field.startsWith('attr:')) {
              result[field] = element.getAttribute(field.slice(5))
            } else {
              result[field] = element.getAttribute(field)
            }
          }
          for (const [key, value] of Object.entries(result)) {
            if (value && value.length > 10_000) result[key] = value.slice(0, 10_000)
          }
          return result
        }, step.fields)
        extractedBytes += Buffer.byteLength(JSON.stringify(row), 'utf8')
        if (extractedBytes > 512 * 1024) {
          throw new Error('Extracted data exceeds the 524288 byte limit')
        }
        rows.push(row)
      }

      return rows
    }

    const locator = this.locator(page, step.target)
    const timeout = step.timeout ?? 10_000
    if (step.state === 'visible') {
      await locator.waitFor({ state: 'visible', timeout })
    } else if (step.state === 'hidden') {
      await locator.waitFor({ state: 'hidden', timeout })
    } else if (step.state === 'attached') {
      await locator.waitFor({ state: 'attached', timeout })
    } else {
      await locator.waitFor({ state: 'attached', timeout })
      const playing = await locator.evaluate((element) => {
        return element instanceof HTMLMediaElement && !element.paused && !element.ended
      })
      if (!playing) throw new Error('Expected media element to be playing')
    }

    return undefined
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined)
    await this.browser?.close().catch(() => undefined)
    this.page = undefined
    this.context = undefined
    this.browser = undefined
    this.blockedNavigation = undefined
  }
}

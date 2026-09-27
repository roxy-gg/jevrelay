# JevRelay

Open-source local MCP runtime for fast browser automation.

An AI creates a declarative Jev Script. JevRelay validates it, runs Playwright locally, and calls the configured inference provider only for explicit bounded decisions.

```text
Claude / ChatGPT / Roxy
-> local @jevrelay/mcp process
-> Playwright actions on the user's computer
-> optional TypeSafe, OpenRouter, or JevRelay decision call
```

Browser cookies, page state, and computer control stay local.

## Status

This is an early MVP. It supports:

- MCP over stdio.
- Chromium through Playwright.
- Declarative Jev Script validation.
- Local actions, extraction, assertions, background runs, status, and cancellation.
- Direct TypeSafe Jev inference.
- OpenRouter structured-output inference.
- The future `api.jevrelay.com/v1/decide` endpoint.

It does not execute arbitrary JavaScript, shell commands, or local files.

## Install

Node.js 20 or newer is required.

```sh
npm install -g @jevrelay/mcp
jevrelay-mcp install-browser
jevrelay-mcp doctor
```

Until the package is published, clone this repository and use:

```sh
npm install
npm run build
npx playwright install chromium
node dist/cli.js doctor
```

## MCP Configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "jevrelay": {
      "command": "npx",
      "args": ["-y", "@jevrelay/mcp"]
    }
  }
}
```

### Roxy

```json
{
  "mcpServers": {
    "jevrelay": {
      "command": "npx",
      "args": ["-y", "@jevrelay/mcp"]
    }
  }
}
```

Scripts without `decide` steps need no provider or API key.

## Inference Providers

Secrets are environment variables on the local MCP process. Never pass provider keys as MCP tool arguments because tool arguments can enter model transcripts and logs.

### TypeSafe Jev

```text
JEVRELAY_PROVIDER=typesafe
TYPESAFE_API_KEY=...
```

### OpenRouter

```text
JEVRELAY_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Choose an OpenRouter model that supports structured outputs.

### JevRelay Provider

```text
JEVRELAY_PROVIDER=jevrelay
JEVRELAY_API_KEY=...
JEVRELAY_API_URL=https://api.jevrelay.com/v1/decide
```

The hosted JevRelay provider is optional and not implemented in this repository.

Example MCP configuration with a direct TypeSafe key:

```json
{
  "mcpServers": {
    "jevrelay": {
      "command": "npx",
      "args": ["-y", "@jevrelay/mcp"],
      "env": {
        "JEVRELAY_PROVIDER": "typesafe",
        "TYPESAFE_API_KEY": "..."
      }
    }
  }
}
```

## MCP Tools

### `jevrelay_validate`

Validates a Jev Script without running it.

### `jevrelay_run`

Runs a script. Arguments:

- `script`: Jev Script object.
- `inputs`: Optional input overrides.
- `headless`: Defaults to `true`.
- `wait`: Defaults to `true`. Set to `false` for a background run.

### `jevrelay_status`

Returns progress and partial output for a run ID.

### `jevrelay_stop`

Requests cancellation of a running automation.

## Jev Script

```json
{
  "version": 1,
  "name": "read-example",
  "permissions": {
    "origins": ["https://example.com"]
  },
  "steps": [
    {
      "action": "browser.goto",
      "url": "https://example.com"
    },
    {
      "action": "browser.assert",
      "target": { "role": "heading", "name": "Example Domain" },
      "state": "visible"
    },
    {
      "action": "browser.extract",
      "target": { "role": "heading", "name": "Example Domain" },
      "fields": ["text"],
      "saveAs": "heading"
    }
  ]
}
```

Run it through MCP, or use the exported `RunManager` from Node.

A decision step chooses only from script-supplied or extracted options:

```json
{
  "decide": {
    "state": "${vars.videos}",
    "question": "Which video best matches the request?",
    "optionsFrom": "videos.href",
    "minimumConfidence": 0.5,
    "saveAs": "videoUrl"
  }
}
```

If confidence is below the threshold, the run returns `needs_input` and does not execute the next action.

## Browser Actions

The MVP supports:

```text
browser.goto
browser.fill
browser.press
browser.click
browser.wait
browser.extract
browser.assert
```

Targets can use:

```json
{ "selector": "article a" }
{ "role": "button", "name": "Play" }
{ "text": "Learn more" }
{ "id": "video-123" }
```

`browser.extract` fields include `text`, `id`, `href`, `value`, `ariaLabel`, `tagName`, and `attr:<name>`.

## Security Boundary

- Scripts declare allowed top-level origins.
- Navigation, redirects, and popups to undeclared top-level origins are blocked.
- Subresources loaded by an allowed page are not origin-restricted in the MVP.
- Unknown actions and fields fail schema validation.
- No shell execution or arbitrary JavaScript exists in the script format.
- Provider secrets come from the local process environment.
- Inference runs only at explicit `decide` steps.
- Low-confidence decisions stop instead of guessing.

This is not yet a complete sandbox. Review generated scripts before using them with sensitive accounts, purchases, messages, or destructive workflows.

## Development

```sh
npm install
npm run format
npm run check
```

Install Chromium once for browser tests and real runs:

```sh
npx playwright install chromium
```

## License

MIT
